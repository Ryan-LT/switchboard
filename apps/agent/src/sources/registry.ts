import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY_DIR } from '../config.js';

/** A live Claude Code process, from ~/.claude/sessions/<pid>.json. */
export interface LiveSession {
  pid: number;
  sessionId: string;
  status: string;
  /** "interactive" for real sessions; print-mode runs (claude -p) are not conversations. */
  kind?: string;
  cwd?: string;
  name?: string;
  updatedAt?: number;
  hostSessionId?: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

/** Live sessions keyed by CLI session id. Entries whose process is gone are ignored. */
export function readRegistry(): Map<string, LiveSession> {
  const out = new Map<string, LiveSession>();
  let names: string[] = [];
  try {
    names = readdirSync(REGISTRY_DIR);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const d = JSON.parse(readFileSync(join(REGISTRY_DIR, name), 'utf8'));
      if (!d?.sessionId || !d.pid || !alive(d.pid)) continue;
      out.set(d.sessionId, {
        pid: d.pid,
        sessionId: d.sessionId,
        status: d.status ?? 'idle',
        kind: d.kind,
        cwd: d.cwd,
        name: d.name,
        updatedAt: d.statusUpdatedAt ?? d.updatedAt,
        hostSessionId: d.hostSessionId,
      });
    } catch {
      /* partially written file; the next scan picks it up */
    }
  }
  return out;
}
