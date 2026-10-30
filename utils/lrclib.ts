import { LRCLIB_SEARCH, type LrclibQuery, type LrclibResult, type LrclibSearchMessage } from './messages';

export type LrcLine = { t: number; text: string };

const API = 'https://lrclib.net/api/search';
const TIMEOUT_MS = 8000;
const MAX_QUERY_LEN = 200;

/** Validate a search message from a content script before it reaches the network. */
export const toQuery = (msg: unknown): LrclibQuery | null => {
  const m = msg as Partial<LrclibSearchMessage> | undefined;
  if (m?.type !== LRCLIB_SEARCH || typeof m.track !== 'string' || typeof m.artist !== 'string') return null;
  const track = m.track.trim().slice(0, MAX_QUERY_LEN);
  if (!track) return null;
  const duration = typeof m.duration === 'number' && Number.isFinite(m.duration) && m.duration > 0 ? m.duration : null;
  return { track, artist: m.artist.trim().slice(0, MAX_QUERY_LEN), duration };
};

// "(Official Video)", "[Lyrics]", "(4K Remaster)" ...
const NOISE_RE =
  /\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|m\/v|remaster(ed)?|live|explicit|color coded)\b[^)\]]*[)\]]/gi;
const FEAT_RE = /\s*[([]?\b(ft|feat|featuring)\.?\s[^)\]]*[)\]]?/gi;
const SEP_RE = /\s+[-–—]\s+/;

/** Best-effort artist/track from a video title and channel name. */
export const parseTrack = (rawTitle: string, rawChannel: string) => {
  const channel = rawChannel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const title = rawTitle.replace(NOISE_RE, '').replace(FEAT_RE, '').split('|')[0]!.trim();

  const [left, ...rest] = title.split(SEP_RE);
  if (left && rest.length) return { artist: left.trim(), track: rest.join(' - ').trim() };

  // K-pop style: ARTIST 'Song' M/V
  const [, artist, track] = title.match(/^(.+?)\s*['"‘“]([^'"’”]+)['"’”]/) ?? [];
  if (artist && track) return { artist: artist.trim(), track: track.trim() };

  return { artist: channel, track: title.replace(/['"‘’“”]/g, '').trim() };
};

export const parseLrc = (lrc: string): LrcLine[] =>
  lrc
    .split('\n')
    .flatMap((line) => {
      const text = line.replace(/\[\d+:\d+(\.\d+)?\]/g, '').trim();
      return [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)].map(([, m, s]) => ({ t: Number(m) * 60 + Number(s), text }));
    })
    .sort((a, b) => a.t - b.t);

type LrcRecord = { trackName: string; artistName: string; duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

// external API response: validate shape before trusting it
const toRecord = (r: unknown): LrcRecord | null => {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const trackName = str(o.trackName);
  const artistName = str(o.artistName);
  if (!trackName || !artistName) return null;
  return {
    trackName,
    artistName,
    duration: typeof o.duration === 'number' ? o.duration : 0,
    instrumental: o.instrumental === true,
    plainLyrics: str(o.plainLyrics),
    syncedLyrics: str(o.syncedLyrics),
  };
};

const search = async (params: Record<string, string>) => {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, {
    headers: { 'Lrclib-Client': `youtube-comment-lyrics v${browser.runtime.getManifest().version}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data: unknown = await res.json();
  return Array.isArray(data) ? data.map(toRecord).filter((r): r is LrcRecord => !!r) : [];
};

/** Prefer synced lyrics and the closest duration (music videos often run longer than the track). */
const pick = (records: LrcRecord[], duration: number | null) =>
  records
    .filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
    .map((r) => ({ r, cost: (duration ? Math.abs(r.duration - duration) : 0) + (r.syncedLyrics ? 0 : 15) }))
    .sort((a, b) => a.cost - b.cost)[0]?.r;

export const findLyrics = async ({ artist, track, duration }: LrclibQuery): Promise<LrclibResult | null> => {
  const attempts: Record<string, string>[] = [
    ...(artist ? [{ track_name: track, artist_name: artist }] : []),
    { q: `${artist} ${track}`.trim() },
  ];
  for (const params of attempts) {
    const best = pick(await search(params), duration);
    if (best) return { artist: best.artistName, track: best.trackName, synced: best.syncedLyrics, plain: best.plainLyrics };
  }
  return null;
};
