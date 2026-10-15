import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP_DIRS } from '../config.js';

/** One Claude Code session as the Claude desktop app stores it (the sidebar's source of truth). */
export interface DesktopSession {
  id: string;
  cliSessionId?: string;
  priorCliSessionIds: string[];
  account: string;
  /** Which app data folder it came from: "Claude" is the app that handles claude:// links. */
  store: string;
  lastFocusedAt: number;
  title: string;
  cwd: string;
  gitRoot?: string;
  createdAt: number;
  lastActivityAt: number;
  model?: string;
  isArchived: boolean;
  completedTurns: number;
  summary?: { status?: string; detail?: string; needs?: string };
  prs: Array<{ n: number; repo: string; url: string; state: string; branch?: string }>;
  file: string;
  mtime: number;
}

const cache = new Map<string, { mtime: number; session: DesktopSession | null }>();

function parse(file: string, account: string, store: string, mtime: number): DesktopSession | null {
  let d: any;
  try {
    d = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!d?.sessionId || !d.cwd) return null;
  const s = d.postTurnSummary;
  return {
    id: d.sessionId,
    cliSessionId: d.cliSessionId,
    priorCliSessionIds: Array.isArray(d.priorCliSessionIds) ? d.priorCliSessionIds : [],
    account,
    store,
    lastFocusedAt: d.lastFocusedAt ?? 0,
    title: d.title || 'Untitled session',
    cwd: d.cwd,
    gitRoot: d.gitAnchors?.[0]?.gitRoot,
    createdAt: d.createdAt ?? mtime,
    lastActivityAt: d.lastActivityAt ?? mtime,
    model: d.model,
    isArchived: !!d.isArchived,
    completedTurns: d.completedTurns ?? 0,
    summary: s ? { status: s.status_category, detail: s.status_detail, needs: s.needs_action } : undefined,
    prs: (Array.isArray(d.prs) ? d.prs : [])
      .filter((p: any) => p && p.prNumber && !p.dismissedFromSession)
      .map((p: any) => ({ n: p.prNumber, repo: p.repo, url: p.url, state: String(p.state || '').toLowerCase(), branch: p.branch })),
    file,
    mtime,
  };
}

/** Reads every desktop session file, re-parsing only files whose mtime changed. */
export function readDesktopSessions(): DesktopSession[] {
  const out: DesktopSession[] = [];
  const seen = new Set<string>();
  for (const root of DESKTOP_DIRS) {
    for (const account of safeReaddir(root)) {
      for (const org of safeReaddir(join(root, account))) {
        const dir = join(root, account, org);
        for (const name of safeReaddir(dir)) {
          if (!name.endsWith('.json')) continue;
          const file = join(dir, name);
          seen.add(file);
          let mtime = 0;
          try {
            mtime = statSync(file).mtimeMs;
          } catch {
            continue;
          }
          const hit = cache.get(file);
          const session = hit && hit.mtime === mtime ? hit.session : parse(file, account, storeName(root), mtime);
          cache.set(file, { mtime, session });
          if (session) out.push(session);
        }
      }
    }
  }
  for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
  return out;
}

/** "Claude" or "Claude2": the app data folder above claude-code-sessions. */
function storeName(root: string) {
  return root.split('/').slice(-2, -1)[0] ?? '';
}

/**
 * The account the Claude app is signed in to right now: the one whose session was focused most recently
 * in the main "Claude" store. Sessions from other accounts can't be opened there directly.
 */
export function activeAccount(sessions: DesktopSession[]): string | undefined {
  let best: DesktopSession | undefined;
  for (const s of sessions) if (s.store === 'Claude' && (!best || s.lastFocusedAt > best.lastFocusedAt)) best = s;
  return best?.account;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
