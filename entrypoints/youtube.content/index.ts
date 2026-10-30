// bundled as a string: WXT's 'ui' mode fetches a web-accessible CSS file at runtime, which Chromium blocks on YouTube
import css from './style.css?inline';
import pageCss from './page.css?inline';
import { createPanel, currentText, type Panel, type PanelActions, type PanelState } from './panel';
import { parseLrc, parseTrack } from '@/utils/lrclib';
import { findCandidates, getThreads, getVideoId, getVideoMeta, mainVideo, readComment, topComment, type Candidate } from '@/utils/youtube';
import {
  LRCLIB_SEARCH,
  SET_SELECTION,
  STATUS,
  TOGGLE,
  type LrclibResult,
  type LrclibSearchMessage,
  type SetSelectionMessage,
  type StatusMessage,
  type ToggleMessage,
} from '@/utils/messages';

const MAX_LEN = 20_000;
const PIN_ATTR = 'data-ytl-pin';

const prefs = storage.defineItem<{ fontSize: number; collapsed: boolean }>('local:prefs', {
  fallback: { fontSize: 14, collapsed: false },
});
const lyricsKey = (videoId: string) => `local:lyrics:${videoId}` as const;
const offsetKey = (videoId: string) => `local:offset:${videoId}` as const;
const TAB_FLAG = 'ytl:tab-on';
const MAX_OFFSET = 120;
// off by default; a per-video setting (true/false) overrides the channel rule
const videoKey = (videoId: string) => `local:enabled:video:${videoId}` as const;
const channelKey = (channelId: string) => `local:enabled:channel:${channelId}` as const;

type VideoMeta = NonNullable<ReturnType<typeof getVideoMeta>>;

const addPinButton = (thread: Element, onPin: (text: string) => unknown) => {
  const comment = topComment(thread);
  const bar = comment?.querySelector('#toolbar') ?? comment?.querySelector('#action-buttons');
  if (!comment || !bar || bar.querySelector(`[${PIN_ATTR}]`)) return;

  const button = document.createElement('button');
  button.setAttribute(PIN_ATTR, '');
  button.type = 'button';
  button.textContent = '📌 Lyrics';
  button.title = 'Show this comment as lyrics';
  // read at click time: YouTube may recycle comment elements
  button.addEventListener('click', () => onPin(readComment(comment).text));
  bar.append(button);
};

const toCandidate = (r: LrclibResult): Candidate | null => {
  const synced = r.synced ? parseLrc(r.synced) : [];
  const text = synced.length ? synced.map((l) => l.text).join('\n') : r.plain;
  if (!text) return null;
  return {
    kind: 'lrclib',
    text: text.slice(0, MAX_LEN),
    label: `LRCLIB · ${r.artist} – ${r.track}${synced.length ? ' (synced)' : ''}`,
    ...(synced.length && { synced }),
  };
};

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  cssInjectionMode: 'manual',

  async main(ctx) {
    const state: PanelState = {
      videoId: null,
      candidates: [],
      idx: 0,
      manual: null,
      lrc: null,
      scanning: false,
      scanned: false,
      offset: 0,
      ...(await prefs.getValue()),
    };
    let active = false;
    let meta: VideoMeta | null = null;
    let panel: Panel | undefined;
    const render = () => {
      panel?.render(state);
      panel?.highlight((mainVideo()?.currentTime ?? 0) - state.offset);
    };
    const savePrefs = () => prefs.setValue({ fontSize: state.fontSize, collapsed: state.collapsed });
    const sleep = (ms: number) => new Promise<void>((r) => ctx.setTimeout(() => r(), ms));
    const isCurrent = (videoId: string) => active && state.videoId === videoId;

    // "on for this tab": lives in memory across SPA navigations; sessionStorage keeps it across reloads
    // and drops it when the tab closes. Only a boolean flag, nothing sensitive.
    let tabOn = (() => {
      try {
        return sessionStorage.getItem(TAB_FLAG) === '1';
      } catch {
        return false;
      }
    })();
    const setTabOn = (on: boolean) => {
      tabOn = on;
      try {
        if (on) sessionStorage.setItem(TAB_FLAG, '1');
        else sessionStorage.removeItem(TAB_FLAG);
      } catch {
        // storage blocked; the in-memory flag still covers SPA navigation
      }
    };

    /** Title/channel lag behind SPA navigation; poll until they belong to `videoId` (max ~10s). */
    const waitForMeta = async (videoId: string) => {
      let found = getVideoMeta(videoId);
      for (let i = 0; i < 50 && !found && state.videoId === videoId; i++) found = (await sleep(200), getVideoMeta(videoId));
      return state.videoId === videoId ? found : null;
    };

    /** Comment candidates first, LRCLIB last; keeps whatever is on screen selected so the view never jumps. */
    const setCandidates = (comments: Candidate[]) => {
      const current = state.candidates[state.idx]?.text;
      state.candidates = state.lrc ? [...comments, state.lrc] : comments;
      state.idx = Math.max(0, state.candidates.findIndex((c) => c.text === current));
      render();
    };

    const scan = () => {
      if (!active) return;
      const threads = getThreads();
      threads.forEach((t) => addPinButton(t, pin));
      if (threads.length) state.scanned = true;
      setCandidates(findCandidates(threads));
    };

    let pending = false;
    const scheduleScan = () => {
      if (pending) return;
      pending = true;
      ctx.setTimeout(() => {
        pending = false;
        scan();
      }, 400);
    };

    // ytd-comments persists across SPA navigations but may be created late; (re)attach when it changes
    const observer = new MutationObserver(scheduleScan);
    let observed: Element | null = null;
    let observerTimer: number | undefined;
    const attachObserver = () => {
      const comments = document.querySelector('ytd-comments#comments');
      if (comments === observed) return;
      observer.disconnect();
      observed = comments;
      if (!comments) return;
      observer.observe(comments, { childList: true, subtree: true });
      scheduleScan();
    };
    ctx.onInvalidated(() => observer.disconnect());

    // comments lazy-load on scroll: jump to them, wait for the first batch, jump back
    const loadComments = async () => {
      const comments = document.querySelector('ytd-comments#comments');
      if (state.scanning) return;
      if (!comments) {
        state.scanned = true;
        return void render();
      }
      const y = window.scrollY;
      state.scanning = true;
      render();
      comments.scrollIntoView({ block: 'start' });
      for (let i = 0; i < 25 && !getThreads().length; i++) await sleep(200);
      window.scrollTo({ top: y });
      Object.assign(state, { scanning: false, scanned: true });
      scan();
    };

    const fetchLrclib = async (videoId: string, { title, channel }: VideoMeta) => {
      const msg: LrclibSearchMessage = {
        type: LRCLIB_SEARCH,
        ...parseTrack(title, channel),
        duration: mainVideo()?.duration ?? null,
      };
      const result = (await browser.runtime.sendMessage(msg).catch(() => null)) as LrclibResult | null;
      if (!result || !isCurrent(videoId)) return;
      state.lrc = toCandidate(result);
      setCandidates(state.candidates.filter((c) => c.kind === 'comment'));
    };

    const loadSaved = async (videoId: string) => {
      const [saved, offset] = await Promise.all([
        storage.getItem<string>(lyricsKey(videoId)),
        storage.getItem<number>(offsetKey(videoId)),
      ]);
      if (!isCurrent(videoId)) return;
      state.manual = saved;
      state.offset = Number.isFinite(offset) ? Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, offset!)) : 0;
      render();
    };

    const activate = () => {
      const { videoId } = state;
      if (active || !videoId) return;
      active = true;
      ui.autoMount();
      attachObserver();
      observerTimer = ctx.setInterval(attachObserver, 1000);
      void loadSaved(videoId);
      if (meta) void fetchLrclib(videoId, meta);
    };

    const deactivate = () => {
      if (active) {
        active = false;
        ui.remove();
        clearInterval(observerTimer);
        observer.disconnect();
        observed = null;
        document.querySelectorAll(`[${PIN_ATTR}]`).forEach((b) => b.remove());
      }
      Object.assign(state, { candidates: [], idx: 0, manual: null, lrc: null, scanning: false, scanned: false, offset: 0 });
    };

    const report = (msg: Omit<StatusMessage, 'type'>) =>
      browser.runtime.sendMessage({ type: STATUS, ...msg } satisfies StatusMessage).catch(() => {});

    /** Decide on/off for the current video from storage, then apply it and update the badge. */
    const evaluate = async () => {
      const { videoId } = state;
      if (!videoId) return void report({ enabled: false, via: null });
      const override = await storage.getItem<boolean>(videoKey(videoId));
      const channelOn = !!meta?.channelId && (await storage.getItem<boolean>(channelKey(meta.channelId))) === true;
      if (state.videoId !== videoId) return;
      // explicit per-video choice wins; otherwise this tab's mode or the channel rule
      const enabled = override ?? (tabOn || channelOn);
      if (enabled) activate();
      else deactivate();
      const via = !enabled ? null : override != null ? (tabOn ? 'tab' : 'video') : channelOn ? 'channel' : 'tab';
      void report({ enabled, via });
    };

    const onNavigate = async () => {
      const videoId = getVideoId();
      if (videoId === state.videoId) return;
      deactivate();
      state.videoId = videoId;
      meta = null;
      if (videoId) meta = await waitForMeta(videoId);
      if (state.videoId === videoId) await evaluate();
    };

    const toggle = async ({ scope }: ToggleMessage) => {
      const { videoId } = state;
      if (!videoId) return;
      if (scope === 'video') {
        // on: this video + every next video in this tab; off: this video and ends the tab mode
        setTabOn(!active);
        await storage.setItem(videoKey(videoId), !active);
      } else {
        meta ??= await waitForMeta(videoId);
        if (!meta?.channelId) return;
        if (scope === 'channel-on') await storage.setItem(channelKey(meta.channelId), true);
        else await storage.removeItem(channelKey(meta.channelId));
        await storage.removeItem(videoKey(videoId)); // let the channel rule decide this video
      }
      await evaluate();
    };

    async function pin(raw: string) {
      const { videoId } = state;
      const text = raw.trim().slice(0, MAX_LEN);
      if (!videoId || !text) return;
      await storage.setItem(lyricsKey(videoId), text);
      state.collapsed = false;
      if (!active) {
        // picking lyrics implies wanting them here; activate() loads the pick just saved
        setTabOn(true);
        await storage.setItem(videoKey(videoId), true);
        return evaluate();
      }
      state.manual = text;
      render();
    }

    const actions: PanelActions = {
      prev: () => {
        state.idx = (state.idx - 1 + state.candidates.length) % state.candidates.length;
        render();
      },
      next: () => {
        state.idx = (state.idx + 1) % state.candidates.length;
        render();
      },
      font: (delta) => {
        state.fontSize = Math.min(28, Math.max(10, state.fontSize + delta));
        render();
        void savePrefs();
      },
      toggle: () => {
        state.collapsed = !state.collapsed;
        render();
        void savePrefs();
      },
      copy: () => navigator.clipboard.writeText(currentText(state) ?? ''),
      clear: async () => {
        const { videoId } = state;
        if (!videoId) return;
        state.manual = null;
        render();
        await storage.removeItem(lyricsKey(videoId));
      },
      scan: loadComments,
      seek: (time) => {
        const video = mainVideo();
        if (video) video.currentTime = Math.max(0, time + state.offset);
      },
      shift: async (delta) => {
        const { videoId } = state;
        if (!videoId) return;
        state.offset = Math.round(Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, state.offset + delta)) * 10) / 10;
        render();
        if (state.offset) await storage.setItem(offsetKey(videoId), state.offset);
        else await storage.removeItem(offsetKey(videoId));
      },
    };

    const ui = await createShadowRootUi(ctx, {
      name: 'yt-lyrics-panel',
      position: 'inline',
      anchor: '#secondary-inner',
      append: 'first',
      css,
      // keep panel clicks/keys away from YouTube's document-level handlers (PiP/miniplayer, space = pause)
      isolateEvents: ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress'],
      onMount: (container, _shadow, host) => {
        panel = createPanel(container, host, actions);
        render();
      },
      onRemove: () => {
        panel?.destroy();
        panel = undefined;
      },
    });

    // pin buttons live in YouTube's DOM, so their style goes in the document
    const pageStyle = Object.assign(document.createElement('style'), { textContent: pageCss });
    document.head.append(pageStyle);
    ctx.onInvalidated(() => pageStyle.remove());

    // poll currentTime per frame instead of timeupdate (~4Hz, lags around seeks); rAF pauses in background tabs
    let video: HTMLVideoElement | null = null;
    const tick = () => {
      if (active && panel) {
        if (!video?.isConnected) video = mainVideo();
        if (video) panel.highlight(video.currentTime - state.offset);
      }
      ctx.requestAnimationFrame(tick);
    };
    ctx.requestAnimationFrame(tick);

    const onMessage = (msg: unknown, sender: { id?: string }) => {
      if (sender.id !== browser.runtime.id) return;
      const m = msg as Partial<SetSelectionMessage | ToggleMessage> | undefined;
      if (m?.type === TOGGLE && (m.scope === 'video' || m.scope === 'channel-on' || m.scope === 'channel-off')) {
        void toggle({ type: TOGGLE, scope: m.scope });
      } else if (m?.type === SET_SELECTION) {
        const fallback = (m as Partial<SetSelectionMessage>).fallback;
        void pin(window.getSelection()?.toString() || (typeof fallback === 'string' ? fallback : ''));
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

    document.addEventListener('yt-navigate-finish', onNavigate, { signal: ctx.signal });
    await onNavigate();
  },
});
