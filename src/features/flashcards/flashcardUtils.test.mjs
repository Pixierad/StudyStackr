import test from 'node:test';
import assert from 'node:assert/strict';
import { answerMatches, buildQuiz, parseCards } from './flashcardUtils.mjs';
test('imports Quizlet TSV, quoted CSV and headers without silently losing malformed rows', () => {
  assert.equal(parseCards('term\tdefinition\ncell\tbasic unit of life')[0].front, 'cell');
  assert.equal(parseCards('"a,b","line one\nline ""two"""', ',')[0].back, 'line one\nline "two"');
  assert.throws(() => parseCards('valid\tanswer\nbroken'), /Row 2/);
  assert.throws(() => parseCards('"unclosed\tanswer'), /unclosed/);
  assert.throws(() => parseCards('q\t'), /non-empty/);
});
test('marks approximate answers while preserving factual numbers and negatives', () => {
  assert.equal(answerMatches('The mitochondria!', 'mitochondria'), true);
  assert.equal(answerMatches('photosynthsis', 'photosynthesis'), true);
  assert.equal(answerMatches('light energy is absorbed by chlorophyll', 'Chlorophyll absorbs light energy'), true);
  assert.equal(answerMatches('100 degrees', '10 degrees'), false);
  assert.equal(answerMatches('it is soluble', 'it is not soluble'), false);
  assert.equal(answerMatches('oxygen', 'oxygen and glucose'), false);
  assert.equal(answerMatches('', 'answer'), false);
  assert.equal(answerMatches('cat', 'car'), false);
});
test('quiz choices are unique and contain correct answers; blank never reveals its missing word', () => {
  const cards = [{ id: 'a', front: 'Q1', back: 'chlorophyll absorbs light' }, { id: 'b', front: 'Q2', back: 'oxygen' }, { id: 'c', front: 'Q3', back: 'oxygen' }];
  for (const q of buildQuiz(cards, 'choice')) { assert.equal(new Set(q.options).size, q.options.length); assert(q.options.includes(q.answer)); }
  const blank = buildQuiz(cards, 'blank').find(q => q.cardId === 'a');
  assert.equal(blank.answer, 'chlorophyll'); assert.equal(blank.before + blank.answer + blank.after, cards[0].back);
  assert.equal(buildQuiz([cards[0]], 'choice')[0].mode, 'written');
});
