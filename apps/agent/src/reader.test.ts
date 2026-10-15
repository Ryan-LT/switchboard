import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, trailingQuestion, waitingOn } from './reader.js';
import type { PullRequest } from './types.js';

const now = Date.UTC(2026, 9, 7, 12);
const base = { live: 'idle' as const, prs: [] as PullRequest[], updatedAt: now - 3600_000, now };
const claude = (text: string, at = now - 3600_000) => ({ lastAssistant: { text, at } });

test('a running session is in progress', () => {
  assert.equal(read({ ...base, live: 'running' }).o, 'progress');
});

test('a permission prompt needs approval', () => {
  const r = read({ ...base, live: 'input' });
  assert.equal(r.o, 'decision');
  assert.equal(r.kind, 'Approval');
});

test('a real trailing question needs a decision', () => {
  const r = read({ ...base, ...claude('The endpoint works. Should I add Redis caching now, or wait until the UI is built?') });
  assert.equal(r.o, 'decision');
  assert.match(r.next, /Redis caching/);
});

test('polite closings are not questions', () => {
  assert.equal(trailingQuestion('Press ⇧⌘O and drag over the text. Anything else?'), undefined);
  assert.equal(trailingQuestion("That's the overview. Let me know if you'd like a diagram."), undefined);
});

test('a request to check something reads as a review', () => {
  const r = read({ ...base, ...claude('Both changes are pushed. Please check it on your iPhone once the deploy is live.') });
  assert.equal(r.o, 'decision');
  assert.equal(r.kind, 'Review');
});

test('"thanks" from you closes the conversation', () => {
  const r = read({ ...base, ...claude('Done, the PDF is ready.', now - 7200_000), lastUser: { text: 'Perfect, thanks!', at: now - 3600_000 } });
  assert.equal(r.o, 'done');
});

test('the Claude app summary says blocked: a decision, or waiting when someone else is named', () => {
  const d = read({ ...base, summary: { status: 'blocked', detail: 'test run complete', needs: 'add results to test plan doc?' } });
  assert.equal(d.o, 'decision');
  assert.equal(d.by, 'app');
  const w = read({ ...base, summary: { status: 'blocked', detail: 'hero image blurry', needs: 'waiting for the photographer to send the original' } });
  assert.equal(w.o, 'waiting');
  assert.equal(w.on, 'design');
});

test('PR states', () => {
  const pr = (p: Partial<PullRequest>): PullRequest => ({ n: 302, repo: 'a/b', url: '', state: 'open', ...p });
  assert.equal(read({ ...base, prs: [pr({})] }).o, 'waiting');
  assert.equal(read({ ...base, prs: [pr({ review: 'changes' })] }).kind, 'Reply');
  assert.equal(read({ ...base, prs: [pr({ review: 'approved', checks: 'pass' })] }).kind, 'Approval');
  assert.equal(read({ ...base, prs: [pr({ state: 'merged' })] }).o, 'progress');
  assert.equal(read({ ...base, updatedAt: now - 86400000, prs: [pr({ state: 'merged' })] }).o, 'done');
});

test('describing a wait is not being blocked', () => {
  const r = read({ ...base, ...claude("I'll explain that today's list also includes files waiting on manual review.") });
  assert.notEqual(r.o, 'waiting');
});

test('being blocked on backend reads as waiting on backend', () => {
  const r = read({ ...base, ...claude("Everything works against the mock, but I can't test the real call until backend deploys the endpoint to staging.") });
  assert.equal(r.o, 'waiting');
  assert.equal(r.on, 'be');
});

test('an error stops the session and needs you', () => {
  const r = read({ ...base, ...claude('API Error: 401 OAuth access token has been revoked.') });
  assert.equal(r.o, 'decision');
  assert.equal(r.kind, 'Error');
});

test('a recently completed turn is your move; an older one has ended; long idle is low-confidence done', () => {
  assert.equal(read({ ...base, summary: { status: 'completed', detail: 'deployed; smoke tests green' } }).o, 'progress');
  assert.equal(read({ ...base, updatedAt: now - 2 * 86400000, summary: { status: 'completed', detail: 'deployed; smoke tests green' } }).o, 'done');
  const stale = read({ ...base, updatedAt: now - 10 * 86400000, ...claude('Here is the overview of the repo.') });
  assert.equal(stale.o, 'done');
  assert.equal(stale.conf, 'low');
});

test('waitingOn needs dependency wording', () => {
  assert.equal(waitingOn('the client'), undefined);
  assert.equal(waitingOn('Sent the three PDFs to the client for sign-off.'), 'client');
});
