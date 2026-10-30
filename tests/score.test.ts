import { describe, expect, it } from 'vitest';
import { MIN_SCORE, scoreLyrics } from '@/utils/score';

const LYRICS = [
  '[Verse 1]',
  'I walked along the empty road',
  'The night was cold, the wind was slow',
  "I called your name, you didn't know",
  'That I was there',
  '[Chorus]',
  'Oh stay with me tonight',
  'Stay with me tonight',
  "Don't let go",
  'Oh stay with me tonight',
  'Stay with me tonight',
  "Don't let go",
].join('\n');

const PROSE = [
  'This song reminds me of summer 2019 when I was driving home from college every weekend with my friends.',
  'We used to blast it on repeat and sing along at the top of our lungs, those were the days honestly.',
  'Miss them so much.',
].join('\n');

const TRACKLIST = Array.from({ length: 12 }, (_, i) => `${i}:${String((i * 7) % 60).padStart(2, '0')} Track number ${i}`).join('\n');

describe('scoreLyrics', () => {
  it('scores pasted lyrics above the threshold', () => {
    expect(scoreLyrics(LYRICS)).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it('rejects prose paragraphs', () => {
    expect(scoreLyrics(PROSE)).toBe(0);
  });

  it('rejects comments with fewer than 6 lines', () => {
    expect(scoreLyrics('la la la\nla la la\nla la la\nla la la\nla la la')).toBe(0);
  });

  it('keeps timestamp tracklists below the threshold', () => {
    expect(scoreLyrics(TRACKLIST)).toBeLessThan(MIN_SCORE);
  });

  it('keeps short joke comments below the threshold', () => {
    expect(scoreLyrics("who's here\nin 2026\n?\nlike\nif\nyou are")).toBeLessThan(MIN_SCORE);
  });

  it('rewards section tags and repetition', () => {
    const plain = LYRICS.replace(/\[[^\]]+\]\n/g, '');
    const unique = plain
      .split('\n')
      .map((l, i) => `${l} ${i}`)
      .join('\n');
    expect(scoreLyrics(LYRICS)).toBeGreaterThan(scoreLyrics(plain));
    expect(scoreLyrics(plain)).toBeGreaterThan(scoreLyrics(unique));
  });

  it('penalises links', () => {
    const spam = `${LYRICS}\nhttps://spam.example\nhttps://spam.example/2`;
    expect(scoreLyrics(spam)).toBeLessThan(scoreLyrics(LYRICS));
  });

  it('boosts pinned and liked comments', () => {
    const base = scoreLyrics(LYRICS);
    expect(scoreLyrics(LYRICS, { pinned: true })).toBeGreaterThan(base);
    expect(scoreLyrics(LYRICS, { likes: 50_000 })).toBeGreaterThan(base);
  });

  it('never returns a negative score', () => {
    const links = Array.from({ length: 8 }, (_, i) => `https://x.example/${i}`).join('\n');
    expect(scoreLyrics(links)).toBe(0);
  });
});
