import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';
import { getRemoteImage, putRemoteImage } from './store.js';

/**
 * Pictures shown on cards. Screenshots you paste into a chat are stored inside the transcript as base64;
 * they are written out once, by content hash, so the page can load them as normal files.
 * Images from GitHub issues and PRs are downloaded on first view with your `gh` login (private repos need it).
 * Cards get a small JPEG made with macOS `sips`; the full image is kept for the viewer.
 */
const DIR = join(DATA_DIR, 'img');
mkdirSync(DIR, { recursive: true });

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_REMOTE = 15 * 1024 * 1024;

const known = new Map<string, string>();
for (const f of readdirSync(DIR)) {
  const m = f.match(/^([0-9a-f]{20})\.(png|jpg|webp|gif)$/);
  if (m) known.set(m[1], f);
}

export const imageId = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 20);

/** Saves a pasted image (base64) and returns its id. Writing happens once per distinct image. */
export function saveChatImage(b64: string, mediaType: string): string | undefined {
  const ext = EXT[mediaType];
  if (!ext || b64.length < 200) return undefined;
  const id = imageId(b64);
  if (!known.has(id)) {
    const file = `${id}.${ext}`;
    try {
      writeFileSync(join(DIR, file), Buffer.from(b64, 'base64'));
      known.set(id, file);
    } catch {
      return undefined;
    }
  }
  return id;
}

/** Registers an image URL from a GitHub issue or PR body; it downloads when first shown. */
export function remoteImage(url: string): string {
  const id = imageId(url);
  if (!getRemoteImage(id)) putRemoteImage(id, url);
  return id;
}

let token: string | undefined | null;
function ghToken(): Promise<string | undefined> {
  if (token !== undefined) return Promise.resolve(token ?? undefined);
  return new Promise((resolve) =>
    execFile('gh', ['auth', 'token'], { timeout: 5000 }, (err, out) => {
      token = err ? null : out.trim() || null;
      resolve(token ?? undefined);
    }),
  );
}

async function download(id: string): Promise<string | undefined> {
  const url = getRemoteImage(id);
  if (!url) return undefined;
  const host = new URL(url).hostname;
  // Only GitHub's own hosts get your token; S3 redirects drop it automatically.
  const auth = host === 'github.com' || host.endsWith('.githubusercontent.com') ? await ghToken() : undefined;
  const res = await fetch(url, { headers: auth ? { Authorization: `token ${auth}` } : {}, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0];
  const ext = EXT[type];
  if (!ext) throw new Error(`not an image (${type})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_REMOTE) throw new Error('image too large');
  const file = `${id}.${ext}`;
  writeFileSync(join(DIR, file), buf);
  known.set(id, file);
  return file;
}

function sips(src: string, out: string, size: number, quality = 80): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), '-Z', String(size), src, '--out', out], { timeout: 20000 }, (err) => (err ? reject(err) : resolve())),
  );
}

const inflight = new Map<string, Promise<{ path: string; type: string } | undefined>>();
const failed = new Map<string, number>();

/** The file to serve: a ~720px thumbnail by default, the original with `full`. */
export function imageFile(id: string, full = false): Promise<{ path: string; type: string } | undefined> {
  if (!/^[0-9a-f]{20}$/.test(id)) return Promise.resolve(undefined);
  const key = `${id}:${full}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    let file = known.get(id);
    if (!file) {
      if ((failed.get(id) ?? 0) > Date.now() - 10 * 60_000) return undefined;
      try {
        file = await download(id);
      } catch (e: any) {
        failed.set(id, Date.now());
        console.error(`[switchboard] image ${id} not downloaded: ${e.message}`);
        return undefined;
      }
      if (!file) return undefined;
    }
    const src = join(DIR, file);
    const ext = file.split('.').pop()!;
    // Small images are served as they are; re-encoding would only make them bigger.
    if (full || ext === 'gif' || statSync(src).size < 150_000) return { path: src, type: TYPES[ext] };
    const thumb = join(DIR, `${id}.t.jpg`);
    if (!existsSync(thumb)) {
      try {
        await sips(src, thumb, 720);
      } catch {
        return { path: src, type: TYPES[ext] };
      }
    }
    return { path: thumb, type: 'image/jpeg' };
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/**
 * A small JPEG (`size` px on its long side, 240 by default, ~10-40 KB) as a data URI, for a surface that can only embed a picture
 * inline: the Claude Code pane draws it inside an SVG.
 */
export async function thumbDataUri(id: string, size = 240): Promise<string | undefined> {
  const f = await imageFile(id, true);
  if (!f) return undefined;
  const px = Math.max(120, Math.min(720, Math.round(size)));
  const small = join(DIR, `${id}.s${px}.jpg`);
  if (!existsSync(small)) {
    try {
      await sips(f.path, small, px, 78);
    } catch {
      return undefined;
    }
  }
  return `data:image/jpeg;base64,${readFileSync(small).toString('base64')}`;
}
