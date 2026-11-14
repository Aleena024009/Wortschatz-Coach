import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWordList, uniqueTextWords, looksLikeProse, germanPart } from '../js/parser.js';
import { respell, malayalam } from '../js/respell.js';

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

test('a structured list: the title is the topic, ## headings are its sections', () => {
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
  assert.deepEqual(topics, ['German Vocabulary – English to German']);
  assert.deepEqual(words.map((w) => [w.article, w.german, w.english, w.subtopic]), [
    ['', 'Heute', 'Today', 'Time Expressions – Zeitangaben'],
    ['', 'Morgen', 'Tomorrow', 'Time Expressions – Zeitangaben'],
    ['', 'Morgen', 'Morning', 'Parts of the Day – Tageszeiten'],
    ['der', 'Januar', 'January', 'The 12 Months – Die 12 Monate'],
    ['die', 'Monate', 'The months (plural)', 'The 12 Months – Die 12 Monate'],
    ['', 'Hallo', 'Hello', 'Greetings'],
  ]);
  assert.ok(words.every((w) => w.topic === 'German Vocabulary – English to German' && w.level === 'A1'));
});

test('numbers list: one topic with sections; only one heading level means topics', () => {
  const numbers = parseWordList('# German Numbers – Zahlen von 1 bis 100\n## Numbers 1–20\none – eins\ntwo – zwei\n## Tens\nthirty – dreißig', [], '', 'en-de');
  assert.deepEqual(numbers.words.map((w) => [w.german, w.topic, w.subtopic]), [
    ['eins', 'German Numbers – Zahlen von 1 bis 100', 'Numbers 1–20'],
    ['zwei', 'German Numbers – Zahlen von 1 bis 100', 'Numbers 1–20'],
    ['dreißig', 'German Numbers – Zahlen von 1 bis 100', 'Tens'],
  ]);
  const flat = parseWordList('## Months\nJanuary – Januar\n## Days\nMonday – Montag', [], '', 'en-de');
  assert.deepEqual(flat.words.map((w) => [w.topic, w.subtopic]), [['Months', ''], ['Days', '']]);
});

test('a plain title line before ## headings is the topic, the headings its sections', () => {
  const { words, topics } = parseWordList('German Numbers – Zahlen von 1 bis 100\n\n## Numbers 0–20\nzero – null\n## Numbers 21–29\ntwenty-one – einundzwanzig', [], '', 'en-de');
  assert.deepEqual(topics, ['German Numbers – Zahlen von 1 bis 100']);
  assert.deepEqual(words.map((w) => [w.german, w.topic, w.subtopic]), [
    ['null', 'German Numbers – Zahlen von 1 bis 100', 'Numbers 0–20'],
    ['einundzwanzig', 'German Numbers – Zahlen von 1 bis 100', 'Numbers 21–29'],
  ]);
});

test('with a topic chosen, the headings of a pasted list become its sections', () => {
  const { words } = parseWordList('one – eins\n# Tens\nthirty – dreißig', [], '', 'en-de', 'German Numbers');
  assert.deepEqual(words.map((w) => [w.topic, w.subtopic]), [['German Numbers', ''], ['German Numbers', 'Tens']]);
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
  assert.equal(respell('Eins'), 'EYNS');
  assert.equal(respell('W-Fragen'), 'VAY FRAH-gun');
});

test('finds the German half of a topic name on either side', () => {
  const names = {
    'Question Words – W-Fragen': 'W-Fragen', 'Verbs – Verben': 'Verben', 'Family – Die Familie': 'Die Familie',
    'Colours – Die Farben': 'Die Farben', 'The Seasons – Die Jahreszeiten': 'Die Jahreszeiten', 'The Numbers – Die Zahlen': 'Die Zahlen',
    'The German Alphabets – Das deutsche Buchstaben': 'Das deutsche Buchstaben', 'Weekend – Das Wochenende': 'Das Wochenende',
    'Days of the Week – Die Wochentage': 'Die Wochentage', 'The Twelve Months – Die Zwölf Monate': 'Die Zwölf Monate',
    'Greetings and Farewells – Begrüßungen und Verabschiedungen': 'Begrüßungen und Verabschiedungen',
    'Parts of the Day – Tageszeiten': 'Tageszeiten', 'Time Expressions – Zeitangaben': 'Zeitangaben',
    'W-fragen – W-questions': 'W-fragen', 'Zeitangaben – Time Expressions': 'Zeitangaben', 'Numbers 0–20': '', 'Die Zahlen': 'Die Zahlen',
  };
  for (const [name, german] of Object.entries(names)) assert.equal(germanPart(name), german, name);
});

test('pronunciation in Malayalam letters', () => {
  assert.equal(malayalam('Guten Morgen'), 'ഗൂടെൻ മൊർഗെൻ');
  assert.equal(malayalam('der Hund'), 'ഡേർ ഹുന്റ്');
  assert.equal(malayalam('Danke'), 'ഡങ്കെ');
  assert.equal(malayalam('Auf Wiedersehen'), 'ഔഫ് വീഡെർസേയെൻ');
});

test('a sentence starting with der/die/das is not split into article and noun', () => {
  const { words } = parseWordList('The clock hangs on the wall. – Die Uhr hängt an der Wand.\nkey – der Schlüssel', [], 'A1', 'en-de');
  assert.equal(words[0].article, '');
  assert.equal(words[0].german, 'Die Uhr hängt an der Wand.');
  assert.equal(words[1].article, 'der');
  assert.equal(words[1].german, 'Schlüssel');
});
