export function parseCards(text, delimiter = '\t') {
  if (text.length > 1000000) throw new Error('Import at most 1 MB of text.');
  const rows = []; let row = [], cell = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i <= source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === '') quoted = !quoted;
      else cell += ch;
    } else if (!quoted && (ch === delimiter || ch === '\n' || ch === undefined)) {
      row.push(cell.trim()); cell = '';
      if (ch !== delimiter) { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (ch !== undefined) cell += ch;
  }
  if (quoted) throw new Error('An imported field has an unclosed quote.');
  if (rows[0] && /^(term|question|front)$/i.test(rows[0][0]) && /^(definition|answer|back)$/i.test(rows[0][1])) rows.shift();
  if (!rows.length) throw new Error('Add at least one question and answer.');
  if (rows.length > 500) throw new Error('Import up to 500 cards per set.');
  return rows.map((r, i) => {
    if (r.length !== 2 || !r[0] || !r[1]) throw new Error(`Row ${i + 1}: use exactly two non-empty fields with the selected separator.`);
    if (r.some(v => v.length > 4000)) throw new Error(`Row ${i + 1}: keep each field under 4,000 characters.`);
    return { id: `card-${i}-${Date.now()}`, front: r[0], back: r[1], status: 'unknown' };
  });
}
export const normalizeAnswer = value => String(value).normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}+-]+/gu, ' ').trim();
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length];
}
// Deterministic approximate marking: tolerate wording and typos, preserve numbers and negation.
export function answerMatches(input, expected) {
  const a = normalizeAnswer(input), b = normalizeAnswer(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length > 4000 || b.length > 4000) return false;
  const numbers = s => (s.match(/[+-]?\d+/g) || []).sort().join(',');
  const negative = s => /\b(no|not|never|without|cannot|cant|isnt|doesnt|dont)\b/.test(s);
  if (numbers(a) !== numbers(b) || negative(a) !== negative(b)) return false;
  if (Math.max(a.length, b.length) <= 100 && b.length >= 5 && distance(a, b) <= Math.floor(b.length * .15)) return true;
  const tokens = s => s.split(' ').filter(t => !/^(a|an|the|is|are|of|to|in|it|that|this|and|by|be|as)$/.test(t)).map(t => t.length > 5 ? t.replace(/(ing|ed|s)$/, '') : t);
  const aa = [...new Set(tokens(a))], bb = [...new Set(tokens(b))];
  if (!aa.length || !bb.length) return false;
  const matches = bb.filter(t => aa.some(v => t === v || (t.length >= 5 && distance(t, v) <= 1))).length;
  return matches / bb.length >= .85 && matches / aa.length >= .8;
}
export function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function buildQuiz(cards, mode) {
  return shuffled(cards).map(card => {
    const options = shuffled([...new Set(cards.filter(c => c.id !== card.id).map(c => c.back))].filter(v => normalizeAnswer(v) !== normalizeAnswer(card.back))).slice(0, 3);
    if (mode === 'choice' && options.length) return { cardId: card.id, prompt: card.front, answer: card.back, options: shuffled([card.back, ...options]), mode };
    if (mode === 'blank') {
      const word = card.back.match(/[\p{L}\p{N}]+/gu)?.sort((a, b) => b.length - a.length)[0] || card.back;
      const at = card.back.indexOf(word);
      return { cardId: card.id, prompt: card.front, before: card.back.slice(0, at), after: card.back.slice(at + word.length), answer: word, mode };
    }
    return { cardId: card.id, prompt: card.front, answer: card.back, mode: 'written' };
  });
}
