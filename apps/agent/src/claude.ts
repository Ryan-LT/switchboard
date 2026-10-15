import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

// The agent may start without your shell's PATH (launchd, some terminals), so look in the installer's default spot too.
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? [join(homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync) ?? 'claude';

/**
 * One prompt through your own Claude Code (`claude -p`), so it runs on your Claude plan with no API key.
 * No tools, no MCP servers, no hooks, nothing saved to your history; it runs from the data folder so no project CLAUDE.md is read.
 */
export function runClaude(system: string, input: string, opts: { model?: string; timeoutMs?: number } = {}): Promise<{ text: string; tokens: number; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', opts.model ?? 'sonnet', '--effort', 'low', '--output-format', 'json', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--system-prompt', system];
    const child = spawn(CLAUDE_BIN, args, { cwd: DATA_DIR, stdio: ['pipe', 'pipe', 'pipe'], timeout: opts.timeoutMs ?? 120_000 });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const j = JSON.parse(out);
        if (j.is_error || code !== 0) throw new Error(j.result || err || `claude exited ${code}`);
        const u = j.usage ?? {};
        const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
        resolve({ text: String(j.result ?? '').trim(), tokens, ms: Date.now() - t0 });
      } catch (e: any) {
        reject(new Error(err.trim() || e.message || `claude exited ${code}`));
      }
    });
    child.stdin.end(input);
  });
}

/** The JSON object in a reply, tolerating code fences or a sentence around it. */
export function parseJson<T>(text: string): T | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}
