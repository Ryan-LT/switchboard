import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'sb-test-'));
const { classify, ghCommandRefs, linksIn, note, relevantLinks, shortRefs } = await import('./links.js');

test('GitHub issue and PR links are normalised to one key per number', () => {
  const a = classify('https://github.com/Acme-Inc/acme-web/issues/232#issuecomment-1.')!;
  assert.equal(a.key, 'gh:acme-inc/acme-web#232');
  assert.equal(a.kind, 'issue');
  assert.equal(a.url, 'https://github.com/Acme-Inc/acme-web/issues/232');
  const p = classify('https://github.com/example-org/shop/pull/1841/files')!;
  assert.equal(p.kind, 'pr');
  assert.equal(p.label, 'PR #1841');
});

test('design and chat links are recognised; docs and localhost are ignored', () => {
  const found = linksIn(
    'see https://www.figma.com/design/AbCdEf1234567890XyZab/Acme-Phase-1-Final?node-id=12362-11911&m=dev and https://acme.slack.com/archives/C0123456789/p1700000000000001, not https://vercel.com/docs or http://localhost:3000',
  );
  assert.deepEqual(found.map((l) => l.kind), ['figma', 'slack']);
  assert.equal(found[0].label, 'Figma · Acme Phase 1 Final');
  assert.equal(found[0].url, 'https://www.figma.com/design/AbCdEf1234567890XyZab/Acme-Phase-1-Final?node-id=12362-11911');
  assert.equal(found[1].label, 'Slack thread');
});

test('gh commands Claude ran point at the issues and PRs it worked on', () => {
  assert.deepEqual(ghCommandRefs('gh issue view 232 --repo Acme-Inc/acme-web --json body'), [{ kind: 'issue', n: 232, repo: 'Acme-Inc/acme-web' }]);
  assert.deepEqual(ghCommandRefs('cd x && gh pr view 302 --comments | head'), [{ kind: 'pr', n: 302, repo: undefined }]);
  assert.deepEqual(ghCommandRefs('gh pr list --limit 20'), []);
});

test('numbers you wrote become refs, but "#1 priority" does not', () => {
  assert.deepEqual(shortRefs('Check issue 232 and PR #302, also #1841. #1 priority'), [
    { n: 232, kind: 'issue' },
    { n: 302, kind: 'pr' },
    { n: 1841 },
  ]);
});

test('cards keep links you shared or Claude worked on, and drop one-off mentions by Claude', () => {
  const map = new Map();
  const l = (u: string) => classify(u)!;
  note(map, l('https://github.com/o/r/issues/1'), 1, { byUser: true });
  note(map, l('https://github.com/o/r/pull/2'), 2, { touched: true });
  note(map, l('https://github.com/o/r/issues/3'), 3, {});
  note(map, l('https://github.com/o/r/issues/4'), 4, {});
  note(map, l('https://github.com/o/r/issues/4'), 5, {});
  assert.deepEqual(relevantLinks([...map.values()]).map((h) => h.n), [2, 1, 4]);
});
