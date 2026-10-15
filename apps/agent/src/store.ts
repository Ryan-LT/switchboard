import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, TOKEN_CAP } from './config.js';
import type { FeedEvent, Meter, Note, Outcome, Reading, WaitingOn } from './types.js';

/** What you set by hand. Everything else is derived from Claude's own files. */
export interface Meta {
  override?: Reading & { baseHash?: string };
  on?: WaitingOn;
  who?: string;
  followUpAt?: number;
  next?: string;
  notes?: Note[];
  snoozeUntil?: number;
  archived?: boolean;
  project?: string;
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS meta (item_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, at INTEGER NOT NULL,
    text TEXT NOT NULL, outcome TEXT, src TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS events_at ON events (at DESC);
  CREATE TABLE IF NOT EXISTS snapshots (item_id TEXT PRIMARY KEY, sig TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (key TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS summaries (item_id TEXT PRIMARY KEY, text TEXT NOT NULL, based_on INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, url TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS gh_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meter (day TEXT PRIMARY KEY, by_app INTEGER NOT NULL DEFAULT 0, by_rules INTEGER NOT NULL DEFAULT 0, by_ai INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0);
`);

const q = {
  metaAll: db.prepare('SELECT item_id, data FROM meta'),
  metaPut: db.prepare('INSERT INTO meta (item_id, data) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET data = excluded.data'),
  eventAdd: db.prepare('INSERT INTO events (item_id, at, text, outcome, src, tokens) VALUES (?, ?, ?, ?, ?, ?)'),
  eventsRecent: db.prepare('SELECT id, item_id, at, text, outcome, src, tokens FROM events ORDER BY at DESC, id DESC LIMIT ?'),
  eventsPrune: db.prepare('DELETE FROM events WHERE at < ?'),
  snapAll: db.prepare('SELECT item_id, sig FROM snapshots'),
  snapPut: db.prepare('INSERT INTO snapshots (item_id, sig) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET sig = excluded.sig'),
  projAll: db.prepare('SELECT key, data FROM projects'),
  projPut: db.prepare('INSERT INTO projects (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data'),
  sumAll: db.prepare('SELECT item_id, text, based_on, at FROM summaries'),
  sumPut: db.prepare('INSERT INTO summaries (item_id, text, based_on, at) VALUES (?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET text = excluded.text, based_on = excluded.based_on, at = excluded.at'),
  imgAll: db.prepare('SELECT id, url FROM images'),
  imgPut: db.prepare('INSERT OR IGNORE INTO images (id, url) VALUES (?, ?)'),
  ghAll: db.prepare('SELECT key, data, at FROM gh_cache'),
  ghPut: db.prepare('INSERT INTO gh_cache (key, data, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, at = excluded.at'),
  meterGet: db.prepare('SELECT by_app, by_rules, by_ai, tokens FROM meter WHERE day = ?'),
  meterAdd: db.prepare(`INSERT INTO meter (day, by_app, by_rules, by_ai, tokens) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET by_app = by_app + excluded.by_app, by_rules = by_rules + excluded.by_rules, by_ai = by_ai + excluded.by_ai, tokens = tokens + excluded.tokens`),
};

// Old events are pruned at startup; 60 days is plenty for an activity feed.
q.eventsPrune.run(Date.now() - 60 * 86400000);

const metaCache = new Map<string, Meta>();
for (const row of q.metaAll.all() as Array<{ item_id: string; data: string }>) {
  try {
    const meta = JSON.parse(row.data);
    // Notes used to be one free-text string; it becomes the first note in the list.
    if (typeof meta.notes === 'string') {
      meta.notes = meta.notes.trim() ? [{ id: `legacy-${row.item_id}`, text: meta.notes.trim(), at: Date.now() }] : undefined;
      q.metaPut.run(row.item_id, JSON.stringify(meta));
    }
    metaCache.set(row.item_id, meta);
  } catch {
    /* ignore corrupt row */
  }
}

export function getMeta(id: string): Meta {
  return metaCache.get(id) ?? {};
}

export function setMeta(id: string, patch: Partial<Meta>): Meta {
  const next: Meta = { ...getMeta(id), ...patch };
  for (const k of Object.keys(next) as Array<keyof Meta>) if (next[k] === undefined || next[k] === null) delete next[k];
  metaCache.set(id, next);
  q.metaPut.run(id, JSON.stringify(next));
  return next;
}

/** AI status summaries; `basedOn` is the timestamp of the last message the summary has read. */
export interface Summary {
  text: string;
  basedOn: number;
  at: number;
}

const summaryCache = new Map<string, Summary>(
  (q.sumAll.all() as Array<{ item_id: string; text: string; based_on: number; at: number }>).map((r) => [r.item_id, { text: r.text, basedOn: r.based_on, at: r.at }]),
);

export function getSummary(id: string): Summary | undefined {
  return summaryCache.get(id);
}

export function putSummary(id: string, s: Summary) {
  summaryCache.set(id, s);
  q.sumPut.run(id, s.text, s.basedOn, s.at);
}

const remoteImages = new Map((q.imgAll.all() as Array<{ id: string; url: string }>).map((r) => [r.id, r.url]));

export function getRemoteImage(id: string): string | undefined {
  return remoteImages.get(id);
}

export function putRemoteImage(id: string, url: string) {
  remoteImages.set(id, url);
  q.imgPut.run(id, url);
}

/** GitHub issue and PR details survive restarts, so the agent doesn't refetch everything on start. */
export function ghCacheAll(): Array<{ key: string; data: string; at: number }> {
  return q.ghAll.all() as Array<{ key: string; data: string; at: number }>;
}

export function ghCachePut(key: string, data: unknown, at: number) {
  q.ghPut.run(key, JSON.stringify(data), at);
}

export function addEvent(itemId: string, at: number, text: string, outcome: Outcome | null | undefined, src: FeedEvent['src'], tokens = 0) {
  q.eventAdd.run(itemId, at, text, outcome ?? null, src, tokens);
}

export function recentEvents(limit = 300): FeedEvent[] {
  return (q.eventsRecent.all(limit) as any[]).map((r) => ({ id: r.id, itemId: r.item_id, at: r.at, text: r.text, outcome: r.outcome, src: r.src, tokens: r.tokens }));
}

export function snapshots(): Map<string, string> {
  return new Map((q.snapAll.all() as Array<{ item_id: string; sig: string }>).map((r) => [r.item_id, r.sig]));
}

export function putSnapshot(id: string, sig: string) {
  q.snapPut.run(id, sig);
}

export function projectOverrides(): Map<string, { icon?: string; hue?: string; group?: string; name?: string }> {
  const out = new Map();
  for (const r of q.projAll.all() as Array<{ key: string; data: string }>) {
    try {
      out.set(r.key, JSON.parse(r.data));
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function putProject(key: string, data: { icon?: string; hue?: string; group?: string; name?: string }) {
  q.projPut.run(key, JSON.stringify(data));
}

const day = () => new Date().toISOString().slice(0, 10);

export function countReading(by: 'app' | 'rules' | 'ai', tokens = 0) {
  q.meterAdd.run(day(), by === 'app' ? 1 : 0, by === 'rules' ? 1 : 0, by === 'ai' ? 1 : 0, tokens);
}

export function meterToday(): Meter {
  const r = q.meterGet.get(day()) as any;
  const byApp = r?.by_app ?? 0, byRules = r?.by_rules ?? 0, byAi = r?.by_ai ?? 0;
  return { readings: byApp + byRules + byAi, byApp, byRules, byAi, tokens: r?.tokens ?? 0, cap: TOKEN_CAP };
}

/** Wraps many writes in one transaction; a rebuild can touch dozens of rows. */
export function batch<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
