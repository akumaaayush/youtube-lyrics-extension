import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanel, type PanelActions, type PanelState } from '@/entrypoints/youtube.content/panel';
import { parseLrc } from '@/utils/lrclib';
import type { Candidate } from '@/utils/youtube';

const SYNCED: Candidate = {
  kind: 'lrclib',
  text: 'plain',
  label: 'LRCLIB · Pink Floyd – High Hopes (synced)',
  synced: parseLrc('[00:10.00] one\n[00:20.00] two\n[00:30.00]\n[00:40.00] four\n[00:50.00] five'),
};
const comment = (text: string, author = '@fan'): Candidate => ({ kind: 'comment', text, label: `comment · ${author}` });

const state = (overrides: Partial<PanelState> = {}): PanelState => ({
  videoId: 'abcdefghijk',
  candidates: [],
  idx: 0,
  manual: null,
  lrc: null,
  scanning: false,
  scanned: false,
  collapsed: false,
  fontSize: 14,
  offset: 0,
  ...overrides,
});

let container: HTMLElement;
let host: HTMLElement;
let actions: { [K in keyof PanelActions]: ReturnType<typeof vi.fn> };

const setup = (s: PanelState) => {
  const panel = createPanel(container, host, actions as unknown as PanelActions);
  panel.render(s);
  return panel;
};
const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T & HTMLElement>(sel)!;
const button = (label: string) => $<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(() => {
  host = document.createElement('div');
  container = document.createElement('div');
  host.append(container);
  document.body.append(host);
  actions = {
    prev: vi.fn(),
    next: vi.fn(),
    font: vi.fn(),
    toggle: vi.fn(),
    copy: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    scan: vi.fn(async () => {}),
    seek: vi.fn(),
    shift: vi.fn(),
  };
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('dark');
});

describe('rendering', () => {
  it('renders untrusted comment text as text, never as HTML', () => {
    const evil = '<img src=x onerror="alert(1)">\n<script>alert(2)</script>\n<a href="javascript:alert(3)">x</a>';
    setup(state({ candidates: [comment(evil, '<b>@evil</b>')] }));
    expect(container.querySelector('img, script, a, b')).toBeNull();
    expect($('.lyrics').textContent).toBe(evil);
    expect($('.source').textContent).toBe('comment · <b>@evil</b>');
  });

  it('hides itself off watch pages', () => {
    setup(state({ videoId: null }));
    expect(host.style.display).toBe('none');
  });

  it.each([
    [{}, 'No lyrics found yet.'],
    [{ scanning: true }, 'Loading comments…'],
    [{ scanned: true }, 'No lyrics found in loaded comments.'],
  ])('empty state %j', (s, msg) => {
    setup(state(s));
    expect($('.lyrics').hidden).toBe(true);
    expect($('.msg').textContent).toBe(msg);
    expect($<HTMLButtonElement>('.pill').disabled).toBe(!!(s as Partial<PanelState>).scanning);
  });

  it('shows the candidate switcher only for several auto candidates', () => {
    const panel = setup(state({ candidates: [comment('a'), comment('b')], idx: 1 }));
    expect($('.lyrics').textContent).toBe('b');
    expect(container.querySelectorAll('.meta .count')[1]!.textContent).toBe('2 / 2');
    expect(button('Next candidate').closest<HTMLElement>('.nav')!.hidden).toBe(false);

    panel.render(state({ candidates: [comment('a'), comment('b')], manual: 'mine' }));
    expect($('.lyrics').textContent).toBe('mine');
    expect($('.source').textContent).toBe('Your pick');
    expect(button('Next candidate').closest<HTMLElement>('.nav')!.hidden).toBe(true);
    expect(button('Unpin your pick (back to auto-detect)').hidden).toBe(false);
  });

  it('collapses the body', () => {
    setup(state({ candidates: [comment('a')], collapsed: true }));
    expect($('.body').hidden).toBe(true);
    expect(button('Expand').getAttribute('aria-expanded')).toBe('false');
  });

  it('wires header buttons to actions', () => {
    setup(state({ candidates: [comment('a'), comment('b')] }));
    button('Next candidate').click();
    button('Previous candidate').click();
    button('Larger text').click();
    button('Smaller text').click();
    button('Collapse').click();
    expect(actions.next).toHaveBeenCalledOnce();
    expect(actions.prev).toHaveBeenCalledOnce();
    expect(actions.font.mock.calls).toEqual([[1], [-1]]);
    expect(actions.toggle).toHaveBeenCalledOnce();
  });
});

describe('synced lyrics', () => {
  let scrollTo: Mock<(options: ScrollToOptions) => void>;
  const lines = () => [...container.querySelectorAll<HTMLElement>('.line')];
  const activeText = () => container.querySelector('.line.active')?.textContent ?? null;

  beforeEach(() => {
    scrollTo = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(scrollTo as unknown as HTMLElement['scrollTo']);
  });

  it('renders one row per line with a placeholder for instrumental gaps', () => {
    setup(state({ candidates: [SYNCED] }));
    expect(lines().map((l) => l.textContent)).toEqual(['one', 'two', '♪', 'four', 'five']);
  });

  it('highlights the current line forwards and after rewinding', () => {
    const panel = setup(state({ candidates: [SYNCED] }));
    panel.highlight(5);
    expect(activeText()).toBeNull();
    panel.highlight(21);
    expect(activeText()).toBe('two');
    panel.highlight(45);
    expect(activeText()).toBe('four');
    panel.highlight(12); // rewind
    expect(activeText()).toBe('one');
    expect(container.querySelectorAll('.line.active')).toHaveLength(1);
  });

  it('snaps on seeks and animates between neighbouring lines', () => {
    const panel = setup(state({ candidates: [SYNCED] }));
    panel.highlight(10);
    panel.highlight(20);
    panel.highlight(50);
    panel.highlight(10);
    expect(scrollTo.mock.calls.map(([o]) => o.behavior)).toEqual(['instant', 'smooth', 'instant', 'instant']);
  });

  it('only scrolls when the line changes', () => {
    const panel = setup(state({ candidates: [SYNCED] }));
    panel.highlight(21);
    panel.highlight(22);
    panel.highlight(23);
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('seeks to a line on click', () => {
    setup(state({ candidates: [SYNCED] }));
    lines()[3]!.click();
    expect(actions.seek).toHaveBeenCalledWith(40);
  });

  it('shows the sync adjuster with the current offset; shift-click moves 5s', () => {
    setup(state({ candidates: [SYNCED], offset: 1.5 }));
    const earlier = button('Show lyrics earlier by 0.5s (Shift: 5s)');
    const later = button('Show lyrics later by 0.5s (Shift: 5s)');
    expect(earlier.closest<HTMLElement>('.nav')!.hidden).toBe(false);
    expect(container.querySelectorAll('.meta .count')[0]!.textContent).toBe('+1.5s');

    earlier.click();
    later.click();
    later.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(actions.shift.mock.calls).toEqual([[-0.5], [0.5], [5]]);
  });

  it('hides the sync adjuster for plain lyrics and manual picks', () => {
    const panel = setup(state({ candidates: [comment('plain')] }));
    const sync = () => button('Show lyrics later by 0.5s (Shift: 5s)').closest<HTMLElement>('.nav')!;
    expect(sync().hidden).toBe(true);
    panel.render(state({ candidates: [SYNCED], manual: 'mine' }));
    expect(sync().hidden).toBe(true);
  });
});

describe('theme', () => {
  it("follows YouTube's dark attribute live and stops after destroy", async () => {
    const panel = setup(state());
    const section = $('section.panel');
    expect(section.classList.contains('dark')).toBe(false);

    document.documentElement.setAttribute('dark', '');
    await new Promise((r) => setTimeout(r));
    expect(section.classList.contains('dark')).toBe(true);

    panel.destroy();
    document.documentElement.removeAttribute('dark');
    await new Promise((r) => setTimeout(r));
    expect(section.classList.contains('dark')).toBe(true);
  });
});
