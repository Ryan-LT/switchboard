/**
 * Optional: start Switchboard at login with launchd.
 *
 *   pnpm autostart:install     write ~/Library/LaunchAgents/dev.switchboard.agent.plist and load it
 *   pnpm autostart:uninstall   unload and remove it
 *
 * Build the web app first (`pnpm build`) so the agent can serve it on http://127.0.0.1:4317.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';

const LABEL = 'dev.switchboard.agent';
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(agentDir, 'node_modules', '.bin', 'tsx');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(tsx)}</string><string>src/index.ts</string></array>
  <key>WorkingDirectory</key><string>${esc(agentDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_NO_WARNINGS</key><string>1</string>
    <key>PATH</key><string>${esc(process.env.PATH ?? '/usr/bin:/bin')}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(join(DATA_DIR, 'agent.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(join(DATA_DIR, 'agent.log'))}</string>
</dict>
</plist>
`;
}

const mode = process.argv[2];
const uid = process.getuid?.() ?? 501;
if (mode === 'install') {
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, plist());
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    /* not loaded yet */
  }
  execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
  console.log(`Switchboard now starts at login. Open http://127.0.0.1:4317\nLogs: ${join(DATA_DIR, 'agent.log')}`);
} else if (mode === 'uninstall') {
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    /* already stopped */
  }
  if (existsSync(plistPath)) rmSync(plistPath);
  console.log('Switchboard no longer starts at login.');
} else {
  console.log(plist());
  console.log('Usage: pnpm autostart:install | pnpm autostart:uninstall');
}
