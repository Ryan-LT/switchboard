import { execFile } from 'node:child_process';
import { GITHUB_TTL_MS } from '../config.js';
import { ghCacheAll, ghCachePut } from '../store.js';
import type { Link, PullRequest } from '../types.js';

/** What we keep about one GitHub issue or PR. */
export interface GhInfo {
  title?: string;
  state?: NonNullable<Link['state']>;
  isPr?: boolean;
  url?: string;
  /** Pictures in the description, first few only. */
  images?: Array<{ url: string; alt?: string }>;
  /** The description, trimmed, for search. */
  body?: string;
  review?: PullRequest['review'];
  checks?: PullRequest['checks'];
  comments?: number;
  missing?: boolean;
}

interface Entry {
  at: number;
  info?: GhInfo;
  inflight?: Promise<GhInfo | undefined>;
}

const cache = new Map<string, Entry>();
for (const r of ghCacheAll()) {
  try {
    cache.set(r.key, { at: r.at, info: JSON.parse(r.data) });
  } catch {
    /* ignore */
  }
}

let ghAvailable: boolean | undefined;
let running = 0;
const waiting: Array<() => void> = [];
let onUpdate: () => void = () => {};

export function onGithubUpdate(fn: () => void) {
  onUpdate = fn;
}

export function githubEnabled() {
  return ghAvailable !== false;
}

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
  });
}

/** At most three `gh` calls at once. */
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function checksOf(rollup: any[]): PullRequest['checks'] {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  const states = rollup.map((c) => String(c.conclusion || c.state || c.status || '').toUpperCase());
  if (states.some((s) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(s))) return 'fail';
  if (states.some((s) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', ''].includes(s))) return 'pending';
  return 'pass';
}

const IMG_MD = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
const IMG_HTML = /<img\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const ALT_HTML = /\balt=["']([^"']*)["']/i;

/** Images in a Markdown/HTML description, in order, skipping badges and avatars. */
export function bodyImages(body: string, limit = 4): Array<{ url: string; alt?: string }> {
  const found: Array<{ url: string; alt?: string; at: number }> = [];
  for (const m of body.matchAll(IMG_MD)) found.push({ url: m[2], alt: m[1] || undefined, at: m.index ?? 0 });
  for (const m of body.matchAll(IMG_HTML)) found.push({ url: m[1], alt: m[0].match(ALT_HTML)?.[1] || undefined, at: m.index ?? 0 });
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((i) => !/shields\.io|badge|avatars\.githubusercontent|\.svg(\?|$)/i.test(i.url) && !seen.has(i.url) && seen.add(i.url))
    .slice(0, limit)
    .map(({ url, alt }) => ({ url, alt }));
}

const clipBody = (b: string) => b.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);

async function fetchInfo(repo: string, n: number, kind?: 'pr' | 'issue'): Promise<GhInfo> {
  if (kind === 'pr') {
    const d = JSON.parse(await gh(['pr', 'view', String(n), '--repo', repo, '--json', 'title,state,isDraft,reviewDecision,statusCheckRollup,comments,url,reviewRequests,body']));
    const state: GhInfo['state'] = d.state === 'MERGED' ? 'merged' : d.state === 'CLOSED' ? 'closed' : d.isDraft ? 'draft' : 'open';
    const review: PullRequest['review'] =
      d.reviewDecision === 'APPROVED' ? 'approved'
      : d.reviewDecision === 'CHANGES_REQUESTED' ? 'changes'
      : (d.comments?.length ?? 0) > 0 ? 'commented'
      : (d.reviewRequests?.length ?? 0) > 0 ? 'requested'
      : null;
    const body = String(d.body ?? '');
    return { title: d.title, state, isPr: true, url: d.url, review, checks: checksOf(d.statusCheckRollup), comments: d.comments?.length ?? 0, images: bodyImages(body), body: clipBody(body) };
  }
  // The issues endpoint answers for both issues and PRs, so it also settles what a bare "#232" is.
  const d = JSON.parse(await gh(['api', `repos/${repo}/issues/${n}`]));
  const isPr = !!d.pull_request;
  const state: GhInfo['state'] = isPr && d.pull_request.merged_at ? 'merged' : d.state === 'closed' ? 'closed' : d.draft ? 'draft' : 'open';
  const body = String(d.body ?? '');
  return { title: d.title, state, isPr, url: d.html_url, images: bodyImages(body), body: clipBody(body) };
}

const keyOf = (repo: string, n: number) => `${repo.toLowerCase()}#${n}`;
const fresh = (e: Entry) => Date.now() - e.at < (e.info?.missing ? 86400000 : e.info?.state === 'open' || e.info?.state === 'draft' ? GITHUB_TTL_MS : 6 * 3600000);

function refresh(repo: string, n: number, kind?: 'pr' | 'issue'): Promise<GhInfo | undefined> {
  const key = keyOf(repo, n);
  const prev = cache.get(key);
  if (prev?.inflight) return prev.inflight;
  const job = slot(() => fetchInfo(repo, n, kind ?? (prev?.info?.isPr ? 'pr' : undefined)))
    .then((info) => {
      ghAvailable = true;
      return info;
    })
    .catch((e: any): GhInfo | undefined => {
      if (e?.code === 'ENOENT') ghAvailable = false;
      // A number that isn't an issue or PR in that repo is remembered as missing for a day.
      if (/HTTP 404|Could not resolve|not found/i.test(String(e?.stderr ?? e?.message))) return { missing: true };
      return prev?.info;
    })
    .then((info) => {
      const at = Date.now();
      cache.set(key, { at, info });
      if (info) ghCachePut(key, info, at);
      if (JSON.stringify(info) !== JSON.stringify(prev?.info)) onUpdate();
      return info;
    });
  cache.set(key, { at: prev?.at ?? 0, info: prev?.info, inflight: job });
  return job;
}

/**
 * Cached details for an issue or PR; schedules a refresh when stale (open ones every 10 minutes, closed ones every 6 hours).
 * GitHub calls cost no AI tokens; they only need the `gh` CLI to be logged in.
 */
export function ghInfo(repo: string | undefined, n: number, kind?: 'pr' | 'issue'): GhInfo | undefined {
  if (ghAvailable === false || !repo) return undefined;
  const hit = cache.get(keyOf(repo, n));
  // A PR first seen as a bare "#n" has no review or checks yet; the PR view fills them in.
  const thin = kind === 'pr' && !!hit?.info && !hit.info.missing && !('review' in hit.info) && Date.now() - hit.at > 60_000;
  if (!hit || (!hit.inflight && (!fresh(hit) || thin))) void refresh(repo, n, kind);
  return hit?.info;
}

/** Waits for the details (up to `ms`), for search, where a pasted issue link should be read right away. */
export async function ghInfoNow(repo: string, n: number, ms = 8000): Promise<GhInfo | undefined> {
  const hit = cache.get(keyOf(repo, n));
  if (hit?.info && fresh(hit)) return hit.info;
  return Promise.race([refresh(repo, n), new Promise<undefined>((r) => setTimeout(r, ms))]).then((v) => v ?? cache.get(keyOf(repo, n))?.info);
}

/** PR state, review and checks, as the reader expects them. */
export function prDetails(repo: string, n: number): Partial<PullRequest> | undefined {
  const i = ghInfo(repo, n, 'pr');
  if (!i || i.missing) return undefined;
  return { title: i.title, state: i.state, review: i.review, checks: i.checks, comments: i.comments, url: i.url };
}
