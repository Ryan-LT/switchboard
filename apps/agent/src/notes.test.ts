import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNotes } from './notes.js';

const a = { id: 'a', text: 'older', at: 1 };
const b = { id: 'b', text: 'newer', at: 2 };

test('notes are kept newest first and empty ones dropped', () => {
  assert.deepEqual(cleanNotes([a, b, { id: 'c', text: '  ', at: 3 }, { text: 'no id', at: 4 }], []), [b, a]);
  assert.equal(cleanNotes([], [a]), undefined);
});

test('a string from an old page adds a note instead of wiping the list', () => {
  const L = cleanNotes('from an old tab', [b, a])!;
  assert.deepEqual(L.slice(1), [b, a]);
  assert.equal(L[0].text, 'from an old tab');
  assert.deepEqual(cleanNotes('', [a]), [a]);
});
