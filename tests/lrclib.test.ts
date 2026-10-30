import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { findLyrics, parseLrc, parseTrack, toQuery } from '@/utils/lrclib';
import { LRCLIB_SEARCH } from '@/utils/messages';

const record = (overrides: Record<string, unknown> = {}) => ({
  trackName: 'High Hopes',
  artistName: 'Pink Floyd',
  duration: 512,
  instrumental: false,
  plainLyrics: 'Beyond the horizon',
  syncedLyrics: '[00:49.68] Beyond the horizon',
  ...overrides,
});

/** Stub fetch with one JSON response per call (status 200 unless a number is given). */
const mockFetch = (...responses: (unknown[] | number)[]) => {
  const fetchMock = vi.fn<typeof fetch>();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce(typeof r === 'number' ? new Response('', { status: r }) : new Response(JSON.stringify(r)));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const calledUrl = (fetchMock: ReturnType<typeof mockFetch>, call = 0) => new URL(String(fetchMock.mock.calls[call]![0]));

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ version: '1.2.3' } as never);
});

describe('parseTrack', () => {
  it.each([
    ['The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO', 'The Weeknd', 'Blinding Lights'],
    ['Pink Floyd - High Hopes (Official Music Video HD)', 'Pink Floyd', 'Pink Floyd', 'High Hopes'],
    ['Blinding Lights', 'The Weeknd - Topic', 'The Weeknd', 'Blinding Lights'],
    ['Blinding Lights', 'TheWeekndVEVO', 'TheWeeknd', 'Blinding Lights'],
    ["NewJeans (뉴진스) 'Super Shy' Official MV", 'HYBE LABELS', 'NewJeans (뉴진스)', 'Super Shy'],
    ['Ed Sheeran - Perfect ft. Beyoncé [Lyrics]', 'Ed Sheeran', 'Ed Sheeran', 'Perfect'],
    ['Coldplay - Yellow (Live at Glastonbury 2016) | HD', 'Coldplay', 'Coldplay', 'Yellow'],
    ['Daft Punk – Get Lucky (Audio)', 'Daft Punk', 'Daft Punk', 'Get Lucky'],
  ])('%s → %s / %s', (title, channel, artist, track) => {
    expect(parseTrack(title, channel)).toEqual({ artist: expect.stringContaining(artist), track });
  });
});

describe('parseLrc', () => {
  it('parses, sorts and expands multi-timestamp lines', () => {
    const lines = parseLrc('[01:02.00][02:10.50] Chorus\n[00:13.42] Yeah\n[00:14.81]\n[00:20]No space');
    expect(lines).toEqual([
      { t: 13.42, text: 'Yeah' },
      { t: 14.81, text: '' },
      { t: 20, text: 'No space' },
      { t: 62, text: 'Chorus' },
      { t: 130.5, text: 'Chorus' },
    ]);
  });

  it('ignores metadata tags and plain lines', () => {
    expect(parseLrc('[ar:Pink Floyd]\n[ti:High Hopes]\njust text')).toEqual([]);
  });
});

describe('toQuery', () => {
  const msg = (o: Record<string, unknown> = {}) => ({ type: LRCLIB_SEARCH, artist: 'Pink Floyd', track: 'High Hopes', duration: 469, ...o });

  it('accepts a valid message', () => {
    expect(toQuery(msg())).toEqual({ artist: 'Pink Floyd', track: 'High Hopes', duration: 469 });
  });

  it.each([null, undefined, 'x', 42, {}, msg({ type: 'other' }), msg({ track: 1 }), msg({ artist: null }), msg({ track: '   ' })])(
    'rejects %j',
    (input) => expect(toQuery(input)).toBeNull(),
  );

  it.each([Infinity, NaN, -5, 0, '469'])('drops invalid duration %s', (duration) => {
    expect(toQuery(msg({ duration }))?.duration).toBeNull();
  });

  it('trims and caps field length', () => {
    const q = toQuery(msg({ track: `  ${'a'.repeat(500)}  `, artist: 'b'.repeat(500) }))!;
    expect(q.track).toHaveLength(200);
    expect(q.artist).toHaveLength(200);
  });
});

describe('findLyrics', () => {
  it('searches by track + artist and sends the client header', async () => {
    const fetchMock = mockFetch([record()]);
    const result = await findLyrics({ artist: 'Pink Floyd', track: 'High Hopes', duration: null });

    expect(result).toEqual({ artist: 'Pink Floyd', track: 'High Hopes', synced: '[00:49.68] Beyond the horizon', plain: 'Beyond the horizon' });
    const url = calledUrl(fetchMock);
    expect(url.origin + url.pathname).toBe('https://lrclib.net/api/search');
    expect(url.searchParams.get('track_name')).toBe('High Hopes');
    expect(url.searchParams.get('artist_name')).toBe('Pink Floyd');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Lrclib-Client']).toBe('youtube-comment-lyrics v1.2.3');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('encodes user-controlled text instead of injecting query params', async () => {
    const fetchMock = mockFetch([record()]);
    await findLyrics({ artist: 'A&B', track: 'Rock & Roll&q=evil', duration: null });
    const url = calledUrl(fetchMock);
    expect(url.searchParams.get('track_name')).toBe('Rock & Roll&q=evil');
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('prefers the duration closest to the video', async () => {
    mockFetch([record({ duration: 420, plainLyrics: 'short' }), record({ duration: 491, plainLyrics: 'close' })]);
    expect((await findLyrics({ artist: 'Pink Floyd', track: 'High Hopes', duration: 469 }))?.plain).toBe('close');
  });

  it('prefers synced lyrics when durations are similar', async () => {
    mockFetch([record({ duration: 470, syncedLyrics: null, plainLyrics: 'plain only' }), record({ duration: 480, plainLyrics: 'synced' })]);
    expect((await findLyrics({ artist: 'Pink Floyd', track: 'High Hopes', duration: 469 }))?.plain).toBe('synced');
  });

  it('skips instrumentals, empty lyrics and malformed records', async () => {
    mockFetch([
      null,
      42,
      'x',
      { trackName: 'No artist' },
      record({ instrumental: true, plainLyrics: 'instrumental' }),
      record({ syncedLyrics: null, plainLyrics: '   ' }),
      record({ plainLyrics: 'valid' }),
    ]);
    expect((await findLyrics({ artist: 'Pink Floyd', track: 'High Hopes', duration: null }))?.plain).toBe('valid');
  });

  it('falls back to a free-text search when the exact search finds nothing', async () => {
    const fetchMock = mockFetch([], [record()]);
    expect(await findLyrics({ artist: 'Pink Floyd', track: 'High Hopes', duration: null })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calledUrl(fetchMock, 1).searchParams.get('q')).toBe('Pink Floyd High Hopes');
  });

  it('uses only the free-text search when the artist is unknown', async () => {
    const fetchMock = mockFetch([record()]);
    await findLyrics({ artist: '', track: 'High Hopes', duration: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrl(fetchMock).searchParams.get('q')).toBe('High Hopes');
  });

  it('returns null on HTTP errors and non-array bodies', async () => {
    mockFetch(500, { error: 'nope' } as never);
    expect(await findLyrics({ artist: 'Pink Floyd', track: 'High Hopes', duration: null })).toBeNull();
  });
});
