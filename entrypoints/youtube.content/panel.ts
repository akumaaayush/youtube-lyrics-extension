import type { Candidate } from '@/utils/youtube';

export type PanelState = {
  videoId: string | null;
  candidates: Candidate[];
  idx: number;
  manual: string | null;
  lrc: Candidate | null;
  scanning: boolean;
  scanned: boolean;
  collapsed: boolean;
  fontSize: number;
  /** synced-lyrics delay in seconds for this video; positive = lyrics later */
  offset: number;
};

export type PanelActions = {
  prev: () => void;
  next: () => void;
  font: (delta: number) => void;
  toggle: () => void;
  copy: () => Promise<void>;
  clear: () => Promise<void>;
  scan: () => Promise<void>;
  seek: (time: number) => void;
  shift: (delta: number) => void;
};

export type Panel = ReturnType<typeof createPanel>;

export const currentText = (s: PanelState) => s.manual ?? s.candidates[s.idx]?.text ?? null;

// Material icon paths (static strings, never user content)
const ICONS = {
  prev: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  next: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  collapse: 'M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z',
  expand: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};

// all text goes through textContent / text nodes: comment content is untrusted, never use innerHTML
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const icon = (d: string) => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
};

const iconBtn = (content: string | SVGElement, label: string, onclick: (e: MouseEvent) => unknown, className = 'icon-btn') => {
  const button = el('button', { type: 'button', className, title: label, onclick }, content);
  button.setAttribute('aria-label', label);
  return button;
};

export const createPanel = (container: HTMLElement, host: HTMLElement, a: PanelActions) => {
  const copy = iconBtn(icon(ICONS.copy), 'Copy lyrics', async () => {
    await a.copy();
    copy.replaceChildren(icon(ICONS.check));
    setTimeout(() => copy.replaceChildren(icon(ICONS.copy)), 1200);
  });
  const clear = iconBtn(icon(ICONS.close), 'Unpin your pick (back to auto-detect)', a.clear);
  const toggle = iconBtn(icon(ICONS.collapse), 'Collapse', a.toggle);
  const fontDown = iconBtn('A−', 'Smaller text', () => a.font(-1), 'icon-btn text');
  const fontUp = iconBtn('A+', 'Larger text', () => a.font(1), 'icon-btn text');

  const source = el('span', { className: 'source' });
  const count = el('span', { className: 'count' });
  const nav = el(
    'div',
    { className: 'nav' },
    iconBtn(icon(ICONS.prev), 'Previous candidate', a.prev, 'icon-btn small'),
    count,
    iconBtn(icon(ICONS.next), 'Next candidate', a.next, 'icon-btn small'),
  );
  const offsetLabel = el('span', { className: 'count' });
  const sync = el(
    'div',
    { className: 'nav' },
    iconBtn('−', 'Show lyrics earlier by 0.5s (Shift: 5s)', (e) => a.shift(e.shiftKey ? -5 : -0.5), 'icon-btn small text'),
    offsetLabel,
    iconBtn('+', 'Show lyrics later by 0.5s (Shift: 5s)', (e) => a.shift(e.shiftKey ? 5 : 0.5), 'icon-btn small text'),
  );
  sync.title = 'Sync adjustment for this video';
  const meta = el('div', { className: 'meta' }, source, sync, nav);

  const lyrics = el('div', { className: 'lyrics' });
  const emptyMsg = el('p', { className: 'msg' });
  const scanBtn = el('button', { type: 'button', className: 'pill', textContent: 'Scan comments', onclick: a.scan });
  const empty = el(
    'div',
    { className: 'empty' },
    emptyMsg,
    scanBtn,
    el('p', { className: 'hint', textContent: 'Or click "📌 Lyrics" on any comment, or select text → right-click → "Set selection as lyrics".' }),
  );
  const body = el('div', { className: 'body' }, lyrics, empty);

  const root = el(
    'section',
    { className: 'panel' },
    el(
      'header',
      {},
      el('h2', { textContent: 'Lyrics' }),
      el('div', { className: 'actions' }, fontDown, fontUp, copy, clear, toggle),
    ),
    meta,
    body,
  );
  root.setAttribute('aria-label', 'Lyrics');
  container.append(root);

  // follow YouTube's own theme switch (html[dark]); its CSS variables don't reach into the shadow root
  const applyTheme = () => root.classList.toggle('dark', document.documentElement.hasAttribute('dark'));
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
  applyTheme();

  let shownKey: string | null = null;
  let lines: { t: number; node: HTMLElement }[] = [];
  let active = -1;

  return {
    render(s: PanelState) {
      host.style.display = s.videoId ? '' : 'none';
      const auto = s.candidates[s.idx];
      const text = currentText(s);
      const multi = !s.manual && s.candidates.length > 1;

      source.textContent = s.manual ? 'Your pick' : (auto?.label ?? '');
      count.textContent = `${s.idx + 1} / ${s.candidates.length}`;
      nav.hidden = !multi;
      sync.hidden = !!s.manual || !auto?.synced?.length;
      offsetLabel.textContent = `${s.offset > 0 ? '+' : ''}${s.offset.toFixed(1)}s`;
      meta.hidden = !source.textContent && !multi;
      clear.hidden = !s.manual;
      copy.hidden = fontDown.hidden = fontUp.hidden = !text;

      lyrics.hidden = !text;
      const key = text && `${s.manual ? 'manual' : auto?.kind}:${text}`;
      if (key !== shownKey) {
        shownKey = key;
        active = -1;
        const synced = s.manual ? undefined : auto?.synced;
        lines = (synced ?? []).map(({ t, text: line }) => ({
          t,
          node: el('div', { className: 'line', textContent: line || '♪', title: 'Jump here', onclick: () => a.seek(t) }),
        }));
        lyrics.replaceChildren(...(lines.length ? lines.map((l) => l.node) : [text ?? '']));
        lyrics.scrollTop = 0;
      }
      lyrics.style.fontSize = `${s.fontSize}px`;

      empty.hidden = !!text;
      emptyMsg.textContent = s.scanning ? 'Loading comments…' : s.scanned ? 'No lyrics found in loaded comments.' : 'No lyrics found yet.';
      scanBtn.disabled = s.scanning;

      body.hidden = s.collapsed;
      toggle.replaceChildren(icon(s.collapsed ? ICONS.expand : ICONS.collapse));
      toggle.title = s.collapsed ? 'Expand' : 'Collapse';
      toggle.setAttribute('aria-label', toggle.title);
      toggle.setAttribute('aria-expanded', String(!s.collapsed));
    },

    /** Highlight the synced line for `time` (lyrics clock, seconds) and keep it centred. No-op for plain lyrics. */
    highlight(time: number) {
      const i = lines.findLastIndex((l) => l.t <= time + 0.2);
      if (i === active) return;
      // more than one line away = seek/rewind: snap instead of animating across the whole song
      const jumped = active === -1 || Math.abs(i - active) > 1;
      lines[active]?.node.classList.remove('active');
      active = i;
      const node = lines[i]?.node;
      if (!node) return;
      node.classList.add('active');
      // scroll the panel only; scrollIntoView would also scroll the page
      lyrics.scrollTo({
        top: node.offsetTop - lyrics.clientHeight / 2 + node.offsetHeight / 2,
        behavior: jumped ? 'instant' : 'smooth',
      });
    },

    destroy() {
      themeObserver.disconnect();
    },
  };
};
