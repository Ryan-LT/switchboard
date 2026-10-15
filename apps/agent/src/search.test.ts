import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'sb-test-'));
const { indexItems, localSearch, tokens } = await import('./search.js');
const { parseBrief } = await import('./summaries.js');

const item = (id: string, over: Record<string, unknown>) =>
  ({ id, title: id, project: 'p', links: [], images: [], reading: { o: 'progress' }, updatedAt: 1, archived: false, ...over }) as any;

test('words are stemmed lightly and stop words dropped', () => {
  assert.deepEqual(tokens('The invitations for users #232'), ['invitation', 'user', '232']);
});

test('a pasted issue link finds the chat that mentions it, before any word match', () => {
  const items = [
    item('a', { aiTitle: 'Invite users without email', about: 'Invitation flow for users without an email address' }),
    item('b', { aiTitle: 'Wedding gallery photos', about: 'Upload 214 photos to the gallery' }),
  ];
  indexItems(items, new Map([
    ['a', { linkKeys: new Set(['gh:acme-inc/acme-web#232']), userTexts: [] }],
    ['b', { linkKeys: new Set(), userTexts: ['the gallery needs captions'] }],
  ]));
  const byLink = localSearch('Any update? https://github.com/Acme-Inc/acme-web/issues/232', items);
  assert.equal(byLink[0].id, 'a');
  assert.equal(byLink[0].via, 'link');
  assert.equal(byLink[0].why, 'Mentions Issue #232');
  const byNumber = localSearch('BE replied on #232', items);
  assert.equal(byNumber[0].id, 'a');
  const byWords = localSearch('Sarah says the gallery captions are wrong on two photos', items);
  assert.equal(byWords[0].id, 'b');
  assert.equal(byWords[0].via, 'words');
});

test("Claude's card reply is parsed and clipped, tolerating code fences", () => {
  const b = parseBrief('```json\n{"title":"Invite users without email (#232)","about":"Lets admins invite users who have no email.","status":"Waiting on BE for the invite endpoint."}\n```')!;
  assert.equal(b.title, 'Invite users without email (#232)');
  assert.equal(b.status, 'Waiting on BE for the invite endpoint');
  assert.equal(parseBrief('no json here'), undefined);
});
