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

test('level lines set the category; other headings start a topic', () => {
  const { words, newCategories, topics } = parseWordList('Level B2\nder Ast - branch\n# A1\ndie Tür - door\n# Travel\nder Zug - train\ndas Ticket - ticket (A2)\n# C1\ndie Muße - leisure', ['A1', 'A2', 'B1', 'B2']);
  assert.deepEqual(words.map((w) => [w.level, w.topic]), [['B2', ''], ['A1', ''], ['A1', 'Travel'], ['A2', 'Travel'], ['C1', 'Travel']]);
  assert.deepEqual(newCategories, ['C1']);
  assert.deepEqual(topics, ['Travel']);
});

test('a structured list with numbered headings (English first)', () => {
  const text = `# German Vocabulary – English to German

## 1. Time Expressions – Zeitangaben

Today – Heute

Tomorrow – Morgen

## 2. Parts of the Day – Tageszeiten

Morning – Morgen

## 4. The 12 Months – Die 12 Monate

January – Der Januar

The months (plural) – Die Monate

Greetings:
Hello – Hallo`;
  const { words, unparsed, topics } = parseWordList(text, ['A1', 'A2', 'B1', 'B2'], 'A1', 'en-de');
  assert.deepEqual(unparsed, []);
  assert.deepEqual(topics, ['German Vocabulary – English to German', 'Time Expressions – Zeitangaben', 'Parts of the Day – Tageszeiten', 'The 12 Months – Die 12 Monate', 'Greetings']);
  assert.deepEqual(words.map((w) => [w.article, w.german, w.english, w.topic, w.level]), [
    ['', 'Heute', 'Today', 'Time Expressions – Zeitangaben', 'A1'],
    ['', 'Morgen', 'Tomorrow', 'Time Expressions – Zeitangaben', 'A1'],
    ['', 'Morgen', 'Morning', 'Parts of the Day – Tageszeiten', 'A1'],
    ['der', 'Januar', 'January', 'The 12 Months – Die 12 Monate', 'A1'],
    ['die', 'Monate', 'The months (plural)', 'The 12 Months – Die 12 Monate', 'A1'],
    ['', 'Hallo', 'Hello', 'Greetings', 'A1'],
  ]);
});

test('known custom category without # and trailing tag', () => {
  const { words } = parseWordList('Travel\nder Bahnhof - station\ndie Uhr - clock (travel)', ['A1', 'Travel']);
  assert.deepEqual(words.map((w) => w.level), ['Travel', 'Travel']);
});

test('words before any level line go to the selected category', () => {
  const { words } = parseWordList('der Hund - dog\nB1\ndie Tür - door', ['A1', 'A2', 'B1', 'B2'], 'A2');
  assert.deepEqual(words.map((w) => w.level), ['A2', 'B1']);
});

test('list numbering is removed and the article still detected', () => {
  const { words } = parseWordList('1. Der Januar - January\n7) die Woche - week\ndie 12 Monate - the 12 months');
  assert.deepEqual(words.map((w) => [w.article, w.german]), [['der', 'Januar'], ['die', 'Woche'], ['die', '12 Monate']]);
});

test('English-first lists', () => {
  const { words } = parseWordList('A1\ndog - der Hund\n1. to go = gehen\nto complain - sich beschweren (B1) | Ich beschwere mich.', ['A1', 'B1'], '', 'en-de');
  assert.deepEqual(
    words.map((w) => [w.article, w.german, w.english, w.level, w.pos, w.example]),
    [
      ['der', 'Hund', 'dog', 'A1', 'noun', ''],
      ['', 'gehen', 'to go', 'A1', 'verb', ''],
      ['', 'sich beschweren', 'to complain', 'B1', 'verb', 'Ich beschwere mich.'],
    ],
  );
});

test('non-level brackets stay part of the meaning', () => {
  const { words } = parseWordList('na ja - well (informal)');
  assert.equal(words[0].english, 'well (informal)');
});

test('example sentence after a pipe, with the level tag before or after it', () => {
  const { words } = parseWordList('der Hund - dog | Der Hund bellt.\ndie Katze - cat (A2) | Die Katze schläft.\ndas Haus - house | Das Haus ist alt. [B1]', ['A2', 'B1']);
  assert.deepEqual(words.map((w) => [w.example, w.level]), [
    ['Der Hund bellt.', ''], ['Die Katze schläft.', 'A2'], ['Das Haus ist alt.', 'B1'],
  ]);
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
