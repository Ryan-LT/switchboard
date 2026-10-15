import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SWITCHBOARD_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'sb-test-'));
const { conversationTail, shortSummary } = await import('./summaries.js');

test('the transcript tail keeps human prompts, Claude text and tool actions, and skips side chains', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'sb-tail-')), 't.jsonl');
  const lines = [
    { type: 'user', message: { content: 'Fix the login button' } },
    { type: 'user', isSidechain: true, message: { content: 'subagent chatter' } },
    { type: 'user', message: { content: '<system-reminder>ignore me</system-reminder>' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }, { type: 'text', text: 'Fixed. Commit it?' }] } },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(conversationTail(path), 'You: Fix the login button\n(Ran pnpm test)\nClaude: Fixed. Commit it?');
});

test('summaries are cut to one glanceable line', () => {
  const long = 'Say "post it" to add Claude\'s draft to #306 for @alex and @sam, asking about the new direct-attach Confirm flow and whether to show date inputs for requirements missing dates. The new flow works but is uncommitted.';
  const s = shortSummary(long)!;
  assert.ok(s.length <= 110, s);
  assert.ok(s.startsWith('Say "post it" to add'));
  assert.equal(shortSummary('PR #302 waiting on review.'), 'PR #302 waiting on review');
});
