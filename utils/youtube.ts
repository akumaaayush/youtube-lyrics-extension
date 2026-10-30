import type { LrcLine } from './lrclib';
import { MIN_SCORE, scoreLyrics } from './score';

export type Candidate = { kind: 'comment' | 'lrclib'; text: string; label: string; synced?: LrcLine[] };

const VIDEO_ID_RE = /^[\w-]{11}$/;

export const getVideoId = () => {
  const { pathname, searchParams } = new URL(location.href);
  const id = pathname === '/watch' ? searchParams.get('v') : pathname.match(/^\/live\/([\w-]{11})/)?.[1];
  return id && VIDEO_ID_RE.test(id) ? id : null;
};

// scoped to #movie_player: thumbnail hover previews also use video.html5-main-video
export const mainVideo = () =>
  document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video') ??
  document.querySelector<HTMLVideoElement>('#movie_player video');

/** Title/channel of the current video, once the watch page has switched to `videoId` (SPA navigation lags). */
export const getVideoMeta = (videoId: string) => {
  if (document.querySelector('ytd-watch-flexy')?.getAttribute('video-id') !== videoId) return null;
  const title = document.querySelector('ytd-watch-metadata h1')?.textContent?.trim();
  const link = document.querySelector<HTMLAnchorElement>('ytd-watch-metadata ytd-channel-name a');
  const channel = link?.textContent?.trim() ?? '';
  // "@handle" or "channel/UC…": stable across renames, used as the per-channel setting key
  const channelId = link?.href ? decodeURIComponent(new URL(link.href).pathname).slice(1, 101) : '';
  return title ? { title, channel, channelId } : null;
};

export const getThreads =() => [...document.querySelectorAll('ytd-comments ytd-comment-thread-renderer')];

/** Top-level comment of a thread (replies live in a sibling #replies container). */
export const topComment = (thread: Element) => thread.querySelector('ytd-comment-view-model, ytd-comment-renderer');

const parseCount = (raw: string) => {
  const [, num, unit] = raw.trim().match(/^([\d.,]+)\s*([kmb])?/i) ?? [];
  if (!num) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[unit?.toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  return parseFloat(num.replace(/,/g, '')) * mult;
};

export const readComment = (comment: Element) => ({
  // full text is in the DOM even when YouTube clamps it behind "Read more"
  text: comment.querySelector('#content-text')?.textContent?.trim() ?? '',
  author: comment.querySelector('#author-text')?.textContent?.trim() ?? '',
  pinned: !!comment.querySelector('#pinned-comment-badge > *'),
  likes: parseCount(comment.querySelector('#vote-count-middle')?.textContent ?? ''),
});

export const findCandidates = (threads: Element[]): Candidate[] => {
  const seen = new Set<string>();
  return threads
    .map(topComment)
    .filter((c): c is Element => !!c)
    .map(readComment)
    .map(({ text, author, pinned, likes }) => ({ text, author, score: scoreLyrics(text, { pinned, likes }) }))
    .filter((c) => c.score >= MIN_SCORE && !seen.has(c.text) && seen.add(c.text))
    .sort((a, b) => b.score - a.score)
    .map(({ text, author }) => ({ kind: 'comment', text, label: `comment · ${author}` }));
};
