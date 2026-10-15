import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { watch } from 'chokidar';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { DESKTOP_DIRS, HOST, PORT, PROJECTS_DIR, REGISTRY_DIR, RESCAN_MS } from './config.js';
import { build, currentVersion, hookEvent, openUrlFor, state } from './state.js';
import { addEvent, putProject, setMeta } from './store.js';
import { onGithubUpdate } from './sources/github.js';
import type { ItemPatch, Reading } from './types.js';
import { cleanNotes } from './notes.js';
import { queueSummaries } from './summaries.js';
import { imageFile, thumbDataUri } from './images.js';
import { aiSearch, localSearch } from './search.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = join(here, '..', '..', 'web', 'dist');

/* ---------- rebuild scheduling ---------- */
const listeners = new Set<(v: number) => void>();
let timer: NodeJS.Timeout | undefined;
let cached: { version: number; json: string; gz: Buffer } | undefined;
let lastBuild = 0;
const MIN_GAP_MS = 1000;

function rebuild() {
  const t0 = performance.now();
  lastBuild = Date.now();
  build();
  queueSummaries(state().items, () => schedule());
  cached = undefined;
  const v = currentVersion();
  listeners.forEach((fn) => fn(v));
  const ms = performance.now() - t0;
  if (ms > 250) console.log(`[switchboard] rebuild took ${ms.toFixed(0)} ms`);
}

/** Coalesces bursts of file events (a busy session writes many lines a second) into at most one rebuild per second. */
function schedule(delay = 300) {
  if (timer) return;
  const wait = Math.max(delay, MIN_GAP_MS - (Date.now() - lastBuild));
  timer = setTimeout(() => {
    timer = undefined;
    try {
      rebuild();
    } catch (e) {
      console.error('[switchboard] rebuild failed', e);
    }
  }, wait);
}

function payload() {
  const v = currentVersion();
  if (!cached || cached.version !== v) {
    const json = JSON.stringify(state());
    cached = { version: v, json, gz: gzipSync(json) };
  }
  return cached;
}

/* ---------- app ---------- */
const app = new Hono();

// Only answer requests addressed to this machine (blocks DNS-rebinding from web pages),
// and only accept changes from Switchboard's own pages (blocks other websites posting to localhost).
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
app.use('*', async (c, next) => {
  const host = (c.req.header('host') ?? '').split(':')[0];
  if (host && !LOCAL_HOSTS.includes(host)) return c.text('Forbidden', 403);
  const origin = c.req.header('origin');
  if (c.req.method !== 'GET' && origin && !c.req.path.startsWith('/hook/')) {
    let ok = false;
    try {
      ok = LOCAL_HOSTS.includes(new URL(origin).hostname);
    } catch {
      ok = false;
    }
    if (!ok) return c.text('Forbidden', 403);
  }
  await next();
});

app.get('/api/state', (c) => {
  const p = payload();
  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('Cache-Control', 'no-store');
  c.header('X-Switchboard-Version', String(p.version));
  if ((c.req.header('accept-encoding') ?? '').includes('gzip')) {
    c.header('Content-Encoding', 'gzip');
    return c.body(new Uint8Array(p.gz));
  }
  return c.body(p.json);
});

app.get('/api/stream', (c) =>
  streamSSE(c, async (stream) => {
    let alive = true;
    const send = (v: number) => stream.writeSSE({ event: 'change', data: String(v) }).catch(() => (alive = false));
    listeners.add(send);
    stream.onAbort(() => {
      alive = false;
      listeners.delete(send);
    });
    await send(currentVersion());
    while (alive) {
      await stream.sleep(25000);
      await stream.writeSSE({ event: 'ping', data: '' }).catch(() => (alive = false));
    }
    listeners.delete(send);
  }),
);

app.patch('/api/items/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as ItemPatch;
  const item = state().items.find((i) => i.id === id);
  if (!item) return c.json({ error: 'Conversation not found. It may have been archived in Claude.' }, 404);
  const now = Date.now();
  if (body.resetOutcome) {
    setMeta(id, { override: undefined, on: undefined, who: undefined, followUpAt: undefined, next: undefined });
    addEvent(id, now, 'Back to the automatic reading', item.auto.o, 'you');
  } else if (body.outcome) {
    const prev = item.reading;
    const o = body.outcome;
    const reading: Reading & { baseHash?: string } = {
      o,
      kind: body.kind ?? (o === prev.o ? prev.kind : o === 'decision' ? 'Decision' : o === 'progress' ? 'Next step planned' : o === 'done' ? 'Done' : ''),
      next: body.next ?? (o === prev.o ? prev.next : o === 'done' ? 'Nothing open' : o === 'progress' ? 'Nothing needed from you yet' : o === 'decision' ? 'Decide the next step' : ''),
      conf: 'high',
      by: 'you',
      on: o === 'waiting' ? body.on ?? prev.on ?? 'be' : undefined,
      evidence: prev.evidence,
      evidenceFrom: prev.evidenceFrom,
      baseHash: lastHashOf(item.id),
    };
    setMeta(id, { override: reading });
    addEvent(id, now, `You set the outcome: ${o === 'decision' ? 'Needs your decision' : o === 'waiting' ? 'Waiting on others' : o === 'progress' ? 'In progress' : 'Done'}`, o, 'you');
  }
  const patch: Record<string, unknown> = {};
  if ('on' in body && !body.outcome) patch.on = body.on;
  if ('who' in body) patch.who = body.who || undefined;
  if ('followUpAt' in body) patch.followUpAt = body.followUpAt ?? undefined;
  if ('next' in body && !body.outcome) patch.next = body.next || undefined;
  if ('notes' in body) patch.notes = cleanNotes(body.notes, item.notes);
  if ('snoozeUntil' in body) patch.snoozeUntil = body.snoozeUntil ?? undefined;
  if ('archived' in body) {
    patch.archived = body.archived || undefined;
    addEvent(id, now, body.archived ? 'Archived in Switchboard' : 'Restored from the archive', null, 'you');
  }
  if ('project' in body) patch.project = body.project || undefined;
  if (Object.keys(patch).length) setMeta(id, patch as any);
  rebuild();
  return c.json({ ok: true, version: currentVersion() });
});

app.post('/api/archive', async (c) => {
  const { ids } = (await c.req.json().catch(() => ({ ids: [] }))) as { ids: string[] };
  const now = Date.now();
  for (const id of ids ?? []) {
    setMeta(id, { archived: true });
    addEvent(id, now, 'Archived in Switchboard', null, 'you');
  }
  rebuild();
  return c.json({ ok: true, archived: ids?.length ?? 0 });
});

app.post('/api/unarchive', async (c) => {
  const { ids } = (await c.req.json().catch(() => ({ ids: [] }))) as { ids: string[] };
  for (const id of ids ?? []) setMeta(id, { archived: undefined });
  rebuild();
  return c.json({ ok: true });
});

/** Starts a new Claude Code session in the project's folder (claude://code/new?folder=…). "No folder" starts a plain one. */
app.post('/api/projects/:key/new', (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const project = state().projects.find((p) => p.key === key);
  if (!project) return c.json({ error: 'Project not found.' }, 404);
  const folder = project.root && existsSync(project.root) ? project.root : undefined;
  if (!folder && key !== 'unfiled') return c.json({ error: `The folder for ${project.name} isn't on this Mac.` }, 404);
  const url = folder ? `claude://code/new?folder=${encodeURIComponent(folder)}` : 'claude://code/new';
  if (c.req.query('dry') === '1') return c.json({ ok: true, dry: true, url });
  execFile('open', [url], (err) => err && console.error('[switchboard] open failed', err.message));
  return c.json({ ok: true, url });
});

app.patch('/api/projects/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const body = (await c.req.json().catch(() => ({}))) as { icon?: string; hue?: string; group?: string; name?: string };
  const current = state().projects.find((p) => p.key === key);
  putProject(key, { icon: body.icon ?? current?.icon, hue: body.hue ?? current?.hue, group: body.group ?? current?.group, name: body.name ?? current?.name });
  rebuild();
  return c.json({ ok: true });
});

/**
 * Opens the conversation in the Claude desktop app.
 * Desktop sessions use claude://code/continue?session=local_…; terminal sessions use claude://resume?session=<id>,
 * which brings the CLI session into the app. Only ids Switchboard already knows are accepted.
 */
app.post('/api/items/:id/open', (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const item = state().items.find((i) => i.id === id);
  if (!item) return c.json({ error: 'Conversation not found.' }, 404);
  const target = openUrlFor(item);
  if (!target) return c.json({ error: 'This conversation has no Claude Code session to open.' }, 400);
  // ?dry=1 reports what would open without opening it (useful for checking a conversation's route).
  if (c.req.query('dry') === '1') return c.json({ ok: true, dry: true, ...target });
  execFile('open', [target.url], (err) => err && console.error('[switchboard] open failed', err.message));
  addEvent(item.id, Date.now(), target.imported ? 'Opened in Claude (imported into the signed-in account)' : 'Opened in Claude', null, 'you');
  return c.json({ ok: true, ...target });
});

/** Opens the session's folder in Finder. Only paths Switchboard already knows about are allowed. */
app.post('/api/items/:id/reveal', (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const item = state().items.find((i) => i.id === id);
  const target = item?.cwd && existsSync(item.cwd) ? item.cwd : undefined;
  if (!target) return c.json({ error: 'Folder not found on this Mac.' }, 404);
  execFile('open', [target]);
  return c.json({ ok: true });
});

/** Card pictures: a small JPEG by default, the original with ?full=1. Ids are content hashes, so they never change. */
app.get('/api/img/:id', async (c) => {
  const f = await imageFile(c.req.param('id'), c.req.query('full') === '1');
  if (!f) return c.text('Not found', 404);
  c.header('Content-Type', f.type);
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  return c.body(new Uint8Array(await readFile(f.path)));
});

/** A card picture as a small data URI, for the Claude Code pane (it embeds pictures in an SVG). */
app.get('/api/thumb/:id', async (c) => {
  const uri = await thumbDataUri(c.req.param('id'), Number(c.req.query('w')) || undefined);
  if (!uri) return c.text('Not found', 404);
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  return c.text(uri);
});

/** Instant search: shared links, then words. No tokens. */
app.post('/api/search', async (c) => {
  const { q } = (await c.req.json().catch(() => ({}))) as { q?: string };
  if (!q?.trim()) return c.json({ hits: [] });
  return c.json({ hits: localSearch(q.slice(0, 8000), state().items) });
});

/** Claude reads every chat's card and picks the ones this message belongs to (a few seconds, a few thousand tokens). */
app.post('/api/search/ai', async (c) => {
  const { q } = (await c.req.json().catch(() => ({}))) as { q?: string };
  if (!q?.trim()) return c.json({ hits: [] });
  try {
    return c.json(await aiSearch(q.slice(0, 8000), state().items));
  } catch (e: any) {
    console.error(`[switchboard] AI search failed: ${String(e.message).slice(0, 200)}`);
    return c.json({ error: /login|auth|credit|limit/i.test(e.message) ? `Claude couldn't run: ${String(e.message).slice(0, 160)}` : 'Claude search failed. The keyword matches below still work.' }, 502);
  }
});

/** Claude Code hooks post here. Body is the hook's JSON from stdin. */
app.post('/hook/:event', async (c) => {
  const event = c.req.param('event').toLowerCase();
  const body = (await c.req.json().catch(() => ({}))) as { session_id?: string };
  hookEvent(event, body.session_id);
  schedule(150);
  return c.json({ ok: true });
});

if (existsSync(WEB_DIST)) {
  app.use('/*', serveStatic({ root: relative(process.cwd(), WEB_DIST) }));
  app.get('*', serveStatic({ path: relative(process.cwd(), join(WEB_DIST, 'index.html')) }));
} else {
  app.get('/', (c) => c.text('Switchboard agent is running. Start the web app with `pnpm dev` and open http://localhost:5173, or run `pnpm start` to build and serve it here.'));
}

function lastHashOf(id: string): string | undefined {
  // The override is tied to the last message so it lapses when a new one arrives.
  const item = state().items.find((i) => i.id === id);
  return item?.last ? String(item.last.at) : undefined;
}

/* ---------- watchers ---------- */
const watched = [...DESKTOP_DIRS, REGISTRY_DIR, PROJECTS_DIR].filter((p) => existsSync(p));
const watcher = watch(watched, {
  ignoreInitial: true,
  depth: 3,
  ignored: (p, stats) => !!stats?.isFile() && !/\.(json|jsonl)$/.test(p),
});
watcher.on('all', () => schedule());
watcher.on('error', (e) => console.error('[switchboard] watcher error', e));
onGithubUpdate(() => schedule(500));
setInterval(() => schedule(0), RESCAN_MS).unref();

const t0 = performance.now();
const first = build();
console.log(
  `[switchboard] ${first.items.length} conversations across ${first.projects.length} projects (${first.sources.desktopSessions} from the Claude app, ${first.sources.liveSessions} live) in ${(performance.now() - t0).toFixed(0)} ms`,
);

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`[switchboard] listening on http://${HOST}:${info.port}`);
});
