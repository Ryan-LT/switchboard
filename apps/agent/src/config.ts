import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const HOME = homedir();

export const CLAUDE_DIR = process.env.SWITCHBOARD_CLAUDE_DIR ?? join(HOME, '.claude');
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
export const REGISTRY_DIR = join(CLAUDE_DIR, 'sessions');

/** Claude desktop app profiles that hold a `claude-code-sessions` store. */
export const DESKTOP_DIRS = ['Claude', 'Claude2']
  .map((name) => join(HOME, 'Library', 'Application Support', name, 'claude-code-sessions'))
  .filter((dir) => existsSync(dir));

export const DATA_DIR = process.env.SWITCHBOARD_DATA_DIR ?? join(HOME, 'Library', 'Application Support', 'Switchboard');
mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = join(DATA_DIR, 'switchboard.db');

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.SWITCHBOARD_PORT ?? 4317);

/** How often GitHub PR details may be refreshed per PR. */
export const GITHUB_TTL_MS = 10 * 60 * 1000;
/** A conversation idle this long, whose last message asks nothing, reads as "Looks finished". */
export const STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Rescan interval as a safety net; file watchers do most of the work. */
export const RESCAN_MS = 30 * 1000;
/** Daily ceiling for AI reading (status summaries run on your Claude plan via `claude -p`). */
export const TOKEN_CAP = 300_000;
