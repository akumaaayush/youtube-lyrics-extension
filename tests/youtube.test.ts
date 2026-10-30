import { afterEach, describe, expect, it } from 'vitest';
import { findCandidates, getThreads, getVideoId, getVideoMeta, mainVideo, readComment, topComment } from '@/utils/youtube';

const goTo = (url: string) => (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);

const LYRICS = 'Oh stay with me tonight\nStay with me tonight\nDon\'t let go\nOh stay with me tonight\nStay with me tonight\nDon\'t let go\n[Chorus]\nla la la';

/** Minimal copy of YouTube's comment markup (fixture only). */
const thread = ({ text, author, likes = '', pinned = false, reply = '' }: { text: string; author: string; likes?: string; pinned?: boolean; reply?: string }) => {
  const t = document.createElement('ytd-comment-thread-renderer');
  const c = document.createElement('ytd-comment-view-model');
  const badge = Object.assign(document.createElement('div'), { id: 'pinned-comment-badge' });
  if (pinned) badge.append(document.createElement('ytd-pinned-comment-badge-renderer'));
  c.append(
    badge,
    Object.assign(document.createElement('a'), { id: 'author-text', textContent: ` ${author} ` }),
    Object.assign(document.createElement('span'), { id: 'content-text', textContent: text }),
    Object.assign(document.createElement('span'), { id: 'vote-count-middle', textContent: likes }),
  );
  t.append(c);
  if (reply) {
    const replies = Object.assign(document.createElement('div'), { id: 'replies' });
    const r = document.createElement('ytd-comment-view-model');
    r.append(Object.assign(document.createElement('span'), { id: 'content-text', textContent: reply }));
    replies.append(r);
    t.append(replies);
  }
  return t;
};

const mountComments = (...threads: HTMLElement[]) => {
  const comments = Object.assign(document.createElement('ytd-comments'), { id: 'comments' });
  comments.append(...threads);
  document.body.append(comments);
  return comments;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('getVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=7jMlFXouPk8', '7jMlFXouPk8'],
    ['https://www.youtube.com/watch?v=7jMlFXouPk8&t=42s&list=abc', '7jMlFXouPk8'],
    ['https://www.youtube.com/live/abcdefghijk?si=x', 'abcdefghijk'],
    ['https://www.youtube.com/watch?v=short', null],
    ['https://www.youtube.com/watch?v=<script>x</', null],
    ['https://www.youtube.com/', null],
    ['https://www.youtube.com/shorts/abcdefghijk', null],
  ])('%s → %s', (url, id) => {
    goTo(url);
    expect(getVideoId()).toBe(id);
  });
});

describe('comments', () => {
  it('reads text, author, pinned state and abbreviated likes', () => {
    const t = thread({ text: LYRICS, author: '@fan', likes: '1.2K', pinned: true });
    expect(readComment(topComment(t)!)).toEqual({ text: LYRICS, author: '@fan', pinned: true, likes: 1200 });
    expect(readComment(topComment(thread({ text: 'x', author: '@a', likes: '' }))!).likes).toBe(0);
  });

  it('uses the top-level comment, not replies', () => {
    const t = thread({ text: 'top', author: '@top', reply: 'reply' });
    expect(readComment(topComment(t)!).text).toBe('top');
  });

  it('only finds threads inside the comments section', () => {
    document.body.append(thread({ text: LYRICS, author: '@outside' }));
    mountComments(thread({ text: LYRICS, author: '@inside' }));
    expect(getThreads()).toHaveLength(1);
  });

  it('ranks lyric comments, drops prose and duplicates', () => {
    mountComments(
      thread({ text: 'Great song, brings back memories of my childhood and my dad.', author: '@prose' }),
      thread({ text: LYRICS, author: '@first', likes: '10' }),
      thread({ text: LYRICS, author: '@copycat' }),
      thread({ text: `${LYRICS}\n${LYRICS}`, author: '@pinned', pinned: true, likes: '3K' }),
    );
    const candidates = findCandidates(getThreads());
    expect(candidates.map((c) => c.label)).toEqual(['comment · @pinned', 'comment · @first']);
    expect(candidates.every((c) => c.kind === 'comment')).toBe(true);
  });
});

describe('getVideoMeta', () => {
  const mountWatch = (videoId: string, href: string) => {
    goTo('https://www.youtube.com/watch?v=' + videoId);
    const flexy = document.createElement('ytd-watch-flexy');
    flexy.setAttribute('video-id', videoId);
    const meta = document.createElement('ytd-watch-metadata');
    const channel = document.createElement('ytd-channel-name');
    channel.append(Object.assign(document.createElement('a'), { href, textContent: 'Pink Floyd' }));
    meta.append(Object.assign(document.createElement('h1'), { textContent: ' High Hopes ' }), channel);
    document.body.append(flexy, meta);
  };

  it('returns title, channel and a stable channel id', () => {
    mountWatch('7jMlFXouPk8', '/@PinkFloyd');
    expect(getVideoMeta('7jMlFXouPk8')).toEqual({ title: 'High Hopes', channel: 'Pink Floyd', channelId: '@PinkFloyd' });
  });

  it('decodes unicode handles and supports /channel/ ids', () => {
    mountWatch('abcdefghijk', '/@%E0%A4%B8%E0%A4%82%E0%A4%97%E0%A5%80%E0%A4%A4');
    expect(getVideoMeta('abcdefghijk')?.channelId).toBe('@संगीत');
    document.body.replaceChildren();
    mountWatch('abcdefghijk', '/channel/UC1234567890123456789012');
    expect(getVideoMeta('abcdefghijk')?.channelId).toBe('channel/UC1234567890123456789012');
  });

  it('returns null while the page still shows the previous video', () => {
    mountWatch('7jMlFXouPk8', '/@PinkFloyd');
    expect(getVideoMeta('abcdefghijk')).toBeNull();
  });
});

describe('mainVideo', () => {
  it('ignores thumbnail hover previews', () => {
    const preview = Object.assign(document.createElement('video'), { className: 'html5-main-video' });
    const player = Object.assign(document.createElement('div'), { id: 'movie_player' });
    const main = Object.assign(document.createElement('video'), { className: 'html5-main-video' });
    player.append(main);
    document.body.append(preview, player);
    expect(mainVideo()).toBe(main);
  });
});
