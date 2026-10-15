/**
 * Claude Code hooks that tell Switchboard about events the moment they happen.
 * Optional: without them Switchboard still works from the files Claude writes, just a little slower.
 *
 *   pnpm hooks:print     show the JSON to add to ~/.claude/settings.json
 *   pnpm hooks:install   merge it in (a backup is written first)
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR, PORT } from './config.js';

const EVENTS: Record<string, string> = {
  Notification: 'notification',
  UserPromptSubmit: 'prompt',
  Stop: 'stop',
  SessionStart: 'start',
  SessionEnd: 'end',
};

const MARK = '127.0.0.1:' + PORT + '/hook/';

function hookEntry(path: string) {
  // -m 1: never slow Claude down when Switchboard isn't running.
  return { hooks: [{ type: 'command', command: `curl -s -m 1 -X POST http://${MARK}${path} -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 || true` }] };
}

function hooksJson() {
  return Object.fromEntries(Object.entries(EVENTS).map(([event, path]) => [event, [hookEntry(path)]]));
}

const mode = process.argv[2] ?? 'print';
const settingsPath = join(CLAUDE_DIR, 'settings.json');

if (mode === 'print') {
  console.log(JSON.stringify({ hooks: hooksJson() }, null, 2));
  console.log(`\nAdd the "hooks" entries above to ${settingsPath}, or run: pnpm hooks:install`);
} else if (mode === 'install') {
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  if (existsSync(settingsPath)) {
    const backup = `${settingsPath}.switchboard-backup-${Date.now()}`;
    copyFileSync(settingsPath, backup);
    console.log(`Backed up ${settingsPath} to ${backup}`);
  }
  settings.hooks ??= {};
  let added = 0;
  for (const [event, path] of Object.entries(EVENTS)) {
    const list: any[] = (settings.hooks[event] ??= []);
    const already = list.some((m) => JSON.stringify(m).includes(MARK));
    if (!already) {
      list.push(hookEntry(path));
      added++;
    }
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(added ? `Added ${added} Switchboard hooks to ${settingsPath}. New Claude Code sessions will use them.` : 'Switchboard hooks were already installed.');
} else {
  console.error('Usage: tsx src/hooks.ts [print|install]');
  process.exit(1);
}
