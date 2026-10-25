import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWordList, uniqueTextWords, looksLikeProse } from '../js/parser.js';
import { respell } from '../js/respell.js';

test('parses the example list with levels, articles and overrides', () => {
  const { words, unparsed } = parseWordList(`A1
der Hund - dog
gehen - to go
A2
die Erfahrung = experience
sich beschweren - to complain (B1)`);
  assert.deepEqual(unparsed, []);
  assert.deepEqual(
    words.map((w) => [w.article, w.german, w.english, w.level, w.pos]),
    [
      ['der', 'Hund', 'dog', 'A1', 'noun'],
      ['', 'gehen', 'to go', 'A1', 'verb'],
      ['die', 'Erfahrung', 'experience', 'A2', 'noun'],
      ['', 'sich beschweren', 'to complain', 'B1', 'verb'],
    ],
  );
});

test('supports every separator and keeps hyphenated words whole', () => {
  const { words } = parseWordList('die E-Mail - email\ndas Haus – house\nschnell: fast\nder Tisch\ttable\nWo ist es? [A2]');
  assert.deepEqual(words.map((w) => [w.german, w.english]), [
    ['E-Mail', 'email'], ['Haus', 'house'], ['schnell', 'fast'], ['Tisch', 'table'],
  ]);
});

test('level line variants and custom categories', () => {
  const { words, newCategories } = parseWordList('Level B2\nder Ast - branch\n# A1\ndie Tür - door\n# Travel\nder Zug - train\ndas Ticket - ticket (A2)', ['A1', 'A2', 'B1', 'B2']);
  assert.deepEqual(words.map((w) => w.level), ['B2', 'A1', 'Travel', 'A2']);
  assert.deepEqual(newCategories, ['Travel']);
});

test('known custom category without # and trailing tag', () => {
  const { words } = parseWordList('Travel\nder Bahnhof - station\ndie Uhr - clock (travel)', ['A1', 'Travel']);
  assert.deepEqual(words.map((w) => w.level), ['Travel', 'Travel']);
});

test('non-level brackets stay part of the meaning', () => {
  const { words } = parseWordList('na ja - well (informal)');
  assert.equal(words[0].english, 'well (informal)');
});

test('example sentence after a pipe', () => {
  const { words } = parseWordList('der Hund - dog | Der Hund bellt.');
  assert.equal(words[0].example, 'Der Hund bellt.');
});

test('prose detection and word extraction', () => {
  const parsed = parseWordList('Gestern bin ich mit meiner Schwester ins Kino gegangen. Der Film war gut.');
  assert.ok(looksLikeProse(parsed));
  assert.ok(!looksLikeProse(parseWordList('der Hund - dog\ngehen - to go')));
  assert.deepEqual(uniqueTextWords('Der Hund, der Hund! E-Mail'), ['Der', 'Hund', 'E-Mail']);
});

test('respelling', () => {
  assert.equal(respell('Schwester'), 'SHVES-tuh');
  assert.equal(respell('der Hund'), 'dair HOONT');
  assert.equal(respell('sich beschweren'), 'zikh buh-SHVAY-run');
  assert.equal(respell('Zeitung'), 'TSY-toong');
});
