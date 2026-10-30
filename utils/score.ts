export const MIN_SCORE = 20;

const SECTION_RE = /\[(chorus|verse|bridge|intro|outro|hook|pre-chorus|refrain)[^\]]*\]/i;
const TIMESTAMP_RE = /^\(?\d{1,2}:\d{2}(:\d{2})?\)?/;

/** Heuristic score: how much a comment looks like pasted song lyrics. 0 = not lyrics. */
export const scoreLyrics = (text: string, { pinned = false, likes = 0 } = {}) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 6) return 0;

  const avgLen = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
  if (avgLen > 80) return 0; // prose paragraphs, not verses

  let score = Math.min(lines.length, 40);
  if (avgLen < 50) score += 10;

  // choruses repeat
  const unique = new Set(lines.map((l) => l.toLowerCase()));
  score += (1 - unique.size / lines.length) * 40;

  if (SECTION_RE.test(text) || /\blyrics\b/i.test(text)) score += 15;

  // tracklists ("0:00 Song name") look like short lines too
  const stamped = lines.filter((l) => TIMESTAMP_RE.test(l)).length;
  if (stamped / lines.length >= 0.5) score -= 20;

  score -= (text.match(/https?:\/\//g) ?? []).length * 10;
  if (pinned) score += 10;
  score += Math.log10(likes + 1) * 2;

  return Math.max(score, 0);
};
