import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeWords } from '../js/sync.js';

const w = (id, german, updatedAt, extra = {}) => ({ id, german, article: '', english: 'x', updatedAt, added: updatedAt, ...extra });

test('words only on this device are uploaded, words only in the cloud are kept', () => {
  const { merged, toUpload } = mergeWords([w('a', 'Hund', 1)], [w('b', 'Katze', 2)]);
  assert.deepEqual(merged.map((x) => x.id).sort(), ['a', 'b']);
  assert.deepEqual(toUpload.map((x) => x.id), ['a']);
});

test('the newer copy wins in both directions', () => {
  const local = [w('a', 'Hund', 5, { level: 'B1' }), w('b', 'Katze', 1, { level: 'A1' })];
  const remote = [w('a', 'Hund', 3, { level: 'A1' }), w('b', 'Katze', 4, { level: 'A2' })];
  const { merged, toUpload } = mergeWords(local, remote);
  const by = Object.fromEntries(merged.map((x) => [x.id, x.level]));
  assert.deepEqual(by, { a: 'B1', b: 'A2' });
  assert.deepEqual(toUpload.map((x) => x.id), ['a']);
});

test('a removal on another device is not undone by an old local copy', () => {
  const { merged, toUpload } = mergeWords([w('a', 'Hund', 1)], [w('a', 'Hund', 2, { deleted: true })]);
  assert.equal(merged[0].deleted, true);
  assert.equal(toUpload.length, 0);
});

test('the same word added on two devices keeps only the earliest', () => {
  const { merged, toUpload } = mergeWords([w('local', 'Hund', 5, { article: 'der' })], [w('cloud', 'Hund', 3, { article: 'der' })], 99);
  const live = merged.filter((x) => !x.deleted);
  assert.deepEqual(live.map((x) => x.id), ['cloud']);
  assert.deepEqual(toUpload.map((x) => [x.id, x.deleted, x.updatedAt]), [['local', true, 99]]);
});
