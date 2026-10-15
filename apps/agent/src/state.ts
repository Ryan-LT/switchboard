import { statSync } from 'node:fs';
import { activeAccount, readDesktopSessions, type DesktopSession } from './sources/desktop.js';
import { readRegistry, type LiveSession } from './sources/registry.js';
import { DATA_DIR } from './config.js';
import { activity7, indexEntries, readTranscript, refreshIndex, transcriptPath, type TranscriptInfo } from './sources/transcripts.js';
import { ghInfo, githubEnabled, prDetails } from './sources/github.js';
import { remoteImage } from './images.js';
import { classify, ghKey, note, relevantLinks, repoFor, type LinkHit } from './links.js';
import { indexItems, type SearchExtra } from './search.js';
import { defaultLook, projectFor } from './projects.js';
import { read } from './reader.js';
import { getBrief } from './summaries.js';
import { addEvent, batch, countReading, getMeta, meterToday, projectOverrides, putProject, putSnapshot, setMeta, snapshots } from './store.js';
import type { ImageRef, Item, Link, LiveState, Project, PullRequest, Reading, State } from './types.js';

/** Live hints pushed by Claude Code hooks (e.g. a permission prompt), keyed by CLI session id. */
const hookHints = new Map<string, { live: LiveState; at: number }>();
let hooksSeen = false;

export function hookEvent(event: string, sessionId: string | undefined) {
  hooksSeen = true;
  if (!sessionId) return;
  const at = Date.now();
  if (event === 'notification') hookHints.set(sessionId, { live: 'input', at });
  else if (event === 'prompt' || event === 'userpromptsubmit') hookHints.set(sessionId, { live: 'running', at });
  else hookHints.delete(sessionId);
}

const CLI_RECENT_MS = 3 * 86400000;
const OUT_LABEL: Record<string, string> = { decision: 'Needs your decision', waiting: 'Waiting on others', progress: 'In progress', done: 'Done' };

function liveFor(cli: string | undefined, registry: Map<string, LiveSession>, t?: TranscriptInfo): LiveState {
  if (!cli) return 'idle';
  const hint = hookHints.get(cli);
  // A hint only holds until the transcript moves past it.
  const lastAt = Math.max(t?.lastAssistant?.at ?? 0, t?.lastUser?.at ?? 0);
  if (hint && hint.at >= lastAt - 1000) return hint.live;
  const r = registry.get(cli);
  if (!r) return 'idle';
  return r.status === 'busy' ? 'running' : 'idle';
}

function mergePrs(fromApp: DesktopSession['prs'], fromTranscript: TranscriptInfo['prLinks']): PullRequest[] {
  const map = new Map<string, PullRequest>();
  for (const p of fromApp) {
    const state = (['open', 'merged', 'closed', 'draft'].includes(p.state) ? p.state : 'open') as PullRequest['state'];
    map.set(`${p.repo}#${p.n}`, { n: p.n, repo: p.repo, url: p.url, state });
  }
  for (const p of fromTranscript) if (!map.has(`${p.repo}#${p.n}`)) map.set(`${p.repo}#${p.n}`, { n: p.n, repo: p.repo, url: p.url, state: 'open' });
  return [...map.values()].map((p) => ({ ...p, ...(prDetails(p.repo, p.n) ?? {}) }));
}

interface Source {
  id: string;
  cli?: string;
  /** Earlier CLI session ids of the same conversation (rewinds, forks, resumes). */
  priorCli?: string[];
  title: string;
  cwd: string;
  gitRoot?: string;
  account: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  summary?: DesktopSession['summary'];
  prs: DesktopSession['prs'];
  /** Archived in the Claude app, or a terminal chat idle for days: kept for search, hidden from the board. */
  archivedBy?: 'claude' | 'age';
}

const isOwnRun = (cwd?: string) => !!cwd && (cwd === DATA_DIR || cwd.startsWith(DATA_DIR + '/'));

let desktopById = new Map<string, DesktopSession>();
let signedInAccount: string | undefined;

/**
 * How to open a conversation in the Claude app. Sessions from the signed-in account open directly;
 * anything else (another account, a terminal session) is imported into the app by its CLI session id.
 */
export function openUrlFor(item: Item): { url: string; imported: boolean } | undefined {
  const d = desktopById.get(item.id);
  const cli = item.cliSessionId && /^[0-9a-f-]{36}$/i.test(item.cliSessionId) ? item.cliSessionId : undefined;
  // The app ignores code/continue for a chat archived there; resume opens it and brings it back from the archive.
  if (d?.isArchived && d.account === signedInAccount && cli) return { url: `claude://resume?session=${cli}`, imported: false };
  if (d && d.store === 'Claude' && d.account === signedInAccount && /^local_[A-Za-z0-9-]{1,64}$/.test(d.id)) {
    return { url: `claude://code/continue?session=${d.id}`, imported: false };
  }
  if (cli) return { url: `claude://resume?session=${cli}`, imported: true };
  return undefined;
}

function collectSources(registry: Map<string, LiveSession>): Source[] {
  const out: Source[] = [];
  const covered = new Set<string>();
  const desktop = readDesktopSessions();
  signedInAccount = activeAccount(desktop);
  desktopById = new Map(desktop.map((s) => [s.id, s]));
  // Signed-in account first, then most recent, so when the same conversation exists in two accounts
  // (for example after importing it), the copy you can open wins.
  const ordered = [...desktop].sort((a, b) => Number(b.account === signedInAccount) - Number(a.account === signedInAccount) || b.lastActivityAt - a.lastActivityAt);
  const keptIds = new Map<string, string>();
  for (const s of ordered) {
    if (s.cliSessionId) covered.add(s.cliSessionId);
    s.priorCliSessionIds.forEach((id) => covered.add(id));
    const ids = [s.cliSessionId, ...s.priorCliSessionIds].filter(Boolean) as string[];
    if (ids.some((id) => keptIds.has(id) && keptIds.get(id) !== s.account)) continue;
    ids.forEach((id) => keptIds.set(id, s.account));
    // Archived in Claude: still searchable, so a chat archived too early can be found and continued.
    out.push({ id: s.id, cli: s.cliSessionId, priorCli: s.priorCliSessionIds, title: s.title, cwd: s.cwd, gitRoot: s.gitRoot, account: s.account, createdAt: s.createdAt, updatedAt: s.lastActivityAt, model: s.model, summary: s.summary, prs: s.prs, archivedBy: s.isArchived ? 'claude' : undefined });
  }
  // Terminal (CLI) sessions have no desktop entry: include live ones and ones active in the last 3 days.
  const now = Date.now();
  for (const [cli, live] of registry) {
    if (covered.has(cli) || live.hostSessionId && out.some((o) => o.id === live.hostSessionId)) continue;
    // Switchboard's own AI summaries run `claude -p` from its data folder; they are not your conversations.
    if (isOwnRun(live.cwd) || (live.kind && live.kind !== 'interactive')) continue;
    covered.add(cli);
    out.push({ id: `cli:${cli}`, cli, title: live.name || 'Terminal session', cwd: live.cwd ?? '', account: 'cli', createdAt: live.updatedAt ?? now, updatedAt: live.updatedAt ?? now, prs: [] });
  }
  return out.filter((s) => s.cwd || s.cli).concat(recentCliOnly(covered, now));
}

function recentCliOnly(covered: Set<string>, now: number): Source[] {
  const out: Source[] = [];
  for (const [id, path] of indexEntries()) {
    if (covered.has(id)) continue;
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    const t = readTranscript(path);
    if (!t || !t.msgs || isOwnRun(t.cwd)) continue;
    // Older terminal chats stay findable by search; only the last few days' show on the board.
    out.push({ id: `cli:${id}`, cli: id, title: t.customTitle || (t.lastPrompt ? t.lastPrompt.slice(0, 60) : 'Terminal session'), cwd: t.cwd ?? '', account: 'cli', createdAt: t.startTime ?? t.stamps[0] ?? mtime, updatedAt: mtime, prs: [], archivedBy: now - mtime > CLI_RECENT_MS ? 'age' : undefined });
  }
  return out;
}

/**
 * A conversation in the Claude app can own several transcripts (rewinds and resumes start a new one).
 * The one written most recently is the conversation's current state.
 */
function freshestTranscript(s: Source): { path?: string; cli?: string } {
  let best: { path?: string; cli?: string; mtime: number } = { cli: s.cli, path: s.cli ? transcriptPath(s.cli) : undefined, mtime: -1 };
  for (const id of [s.cli, ...(s.priorCli ?? [])]) {
    if (!id) continue;
    const path = transcriptPath(id);
    if (!path) continue;
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > best.mtime) best = { path, cli: id, mtime };
  }
  return { path: best.path, cli: best.cli };
}

/** Sessions named only "#302" get the PR's real title when we know it. */
function titleFor(title: string, prs: PullRequest[]): string {
  const m = title.trim().match(/^#(\d+)$/);
  if (!m) return title;
  const pr = prs.find((p) => p.n === Number(m[1]) && p.title);
  return pr ? `#${pr.n} · ${pr.title}` : title;
}

/** Message text for display: Markdown markers removed, whitespace collapsed. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s?|\d+\.\s+)/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The links a card shows. Everything mentioned in the chat is gathered, "#232"-style numbers are resolved against
 * the folder's GitHub repo (only once GitHub confirms they exist), and the most relevant few are kept.
 */
function linksFor(s: Source, t: TranscriptInfo | undefined, prs: PullRequest[]): { shown: LinkHit[]; all: Set<string> } {
  const map = new Map<string, LinkHit>();
  for (const h of t?.links.values() ?? []) map.set(h.key, { ...h });
  for (const p of prs) {
    const l = classify(p.url || `https://github.com/${p.repo}/pull/${p.n}`);
    if (l) note(map, l, 0, { touched: true });
  }
  const repo = repoFor(s.gitRoot || s.cwd);
  const refs = new Map(t?.refs ?? []);
  const titled = s.title.trim().match(/^#(\d+)\b/);
  if (titled) refs.set(Number(titled[1]), { ...(refs.get(Number(titled[1])) ?? { count: 0, byUser: false, firstAt: 0 }), touched: true });
  if (repo) {
    for (const [n, r] of refs) {
      if (map.has(ghKey(repo, n)) || !(r.byUser || r.touched || r.count >= 2)) continue;
      const info = ghInfo(repo, n, r.kind);
      if (!info || info.missing) continue;
      const l = classify(`https://github.com/${repo}/${info.isPr ? 'pull' : 'issues'}/${n}`);
      if (l) map.set(l.key, { ...l, count: r.count, byUser: r.byUser, touched: r.touched, firstAt: r.firstAt });
    }
  }
  // Drop GitHub links that GitHub says don't exist (typos, examples in code).
  for (const [k, h] of map) if ((h.kind === 'issue' || h.kind === 'pr') && h.repo && h.n && ghInfo(h.repo, h.n, h.kind)?.missing) map.delete(k);
  return { shown: relevantLinks([...map.values()]), all: new Set(map.keys()) };
}

function toLink(h: LinkHit, prs: PullRequest[]): Link {
  if ((h.kind === 'issue' || h.kind === 'pr') && h.repo && h.n) {
    const pr = h.kind === 'pr' ? prs.find((p) => p.n === h.n && p.repo?.toLowerCase() === h.repo!.toLowerCase()) : undefined;
    const info = ghInfo(h.repo, h.n, h.kind);
    const kind = info?.isPr === true ? 'pr' : info?.isPr === false ? 'issue' : h.kind;
    return { kind, url: info?.url ?? h.url, label: `${kind === 'pr' ? 'PR' : 'Issue'} #${h.n}`, title: pr?.title ?? info?.title, state: pr?.state ?? info?.state };
  }
  return { kind: h.kind, url: h.url, label: h.label };
}

/**
 * Pictures that show what the task is: your pasted screenshots (the first, which usually shows the ask,
 * then the latest), then images from the linked issues and PRs.
 */
function imagesFor(t: TranscriptInfo | undefined, shown: LinkHit[]): ImageRef[] {
  const out: ImageRef[] = [];
  const chat = t?.images ?? [];
  if (chat.length) {
    const order = [chat[0], ...chat.slice(1).reverse()];
    for (const i of order.slice(0, 8)) out.push({ id: i.id, from: 'chat', caption: i.caption, at: i.at });
  }
  const gh = shown.filter((h) => (h.kind === 'issue' || h.kind === 'pr') && h.repo && h.n).sort((a, b) => Number(a.kind === 'pr') - Number(b.kind === 'pr'));
  for (const h of gh) {
    const info = ghInfo(h.repo!, h.n!, h.kind as 'pr' | 'issue');
    for (const img of info?.images ?? []) {
      if (out.length >= 10) break;
      out.push({ id: remoteImage(img.url), from: info?.isPr ? 'pr' : 'issue', caption: img.alt ?? `${info?.isPr ? 'PR' : 'Issue'} #${h.n}${info?.title ? ` · ${info.title}` : ''}` });
    }
  }
  return out;
}

function sig(item: Item) {
  return [item.reading.o, item.reading.kind, item.live, item.last ? `${item.last.at}` : '', item.prs.map((p) => `${p.n}:${p.state}`).join(',')].join('|');
}

let version = 0;
/** For the first 90 s after start, PR details and readings settle; record them silently instead of flooding the feed. */
const BOOT_AT = Date.now();
const WARMUP_MS = 90_000;
let lastState: State | undefined;

export function currentVersion() {
  return version;
}

export function build(): State {
  const now = Date.now();
  refreshIndex();
  const registry = readRegistry();
  const sources = collectSources(registry);
  const overrides = projectOverrides();
  const usedHues = new Set([...overrides.values()].map((o) => o.hue).filter(Boolean) as string[]);
  const usedIcons = new Set([...overrides.values()].map((o) => o.icon).filter(Boolean) as string[]);
  const projects = new Map<string, Project>();
  const snaps = snapshots();
  const items: Item[] = [];
  const searchExtra = new Map<string, SearchExtra>();
  let transcripts = 0;

  // Natural project for every folder first, so a conversation moved into a project inherits its name and group.
  const natural = new Map<string, ReturnType<typeof projectFor>>();
  for (const s of sources) {
    const p = projectFor(s.cwd, s.gitRoot);
    if (!natural.has(p.key)) natural.set(p.key, p);
  }

  batch(() => {
    for (const s of sources) {
      const { path, cli } = freshestTranscript(s);
      const t = path ? readTranscript(path) : undefined;
      if (t) transcripts++;
      const meta = getMeta(s.id);
      const p = projectFor(s.cwd, s.gitRoot);
      const projectKey = meta.project ?? p.key;
      if (!projects.has(projectKey)) {
        let ov = overrides.get(projectKey) ?? {};
        if (!ov.icon || !ov.hue) {
          // First time we see this project: pick a distinct look and save it so it never changes on its own.
          ov = { ...defaultLook(projectKey, usedHues, usedIcons), ...ov };
          putProject(projectKey, ov);
          overrides.set(projectKey, ov);
        }
        usedHues.add(ov.hue!);
        usedIcons.add(ov.icon!);
        const base = natural.get(projectKey) ?? { key: projectKey, name: projectKey, group: 'Other' };
        projects.set(projectKey, { ...base, ...ov, key: projectKey } as Project);
      }
      const live = liveFor(cli, registry, t);
      const updatedAt = Math.max(s.updatedAt, t?.lastAssistant?.at ?? 0, t?.lastUser?.at ?? 0);
      const prs = mergePrs(s.prs, t?.prLinks ?? []);
      const auto = read({ live, summary: s.summary, lastAssistant: t?.lastAssistant, lastUser: t?.lastUser, prs, updatedAt, now });

      // A manual outcome holds until a new message arrives, then the automatic reading takes over again.
      const lastKey = String(Math.max(t?.lastAssistant?.at ?? 0, t?.lastUser?.at ?? 0) || '');
      if (auto.evidence) auto.evidence = plain(auto.evidence);
      auto.next = plain(auto.next);
      let reading: Reading = auto;
      if (meta.override) {
        if (!meta.override.baseHash || meta.override.baseHash === lastKey) reading = { ...meta.override, by: 'you' };
        else {
          setMeta(s.id, { override: undefined });
          addEvent(s.id, now, 'New message arrived, so the automatic reading is back', auto.o, auto.by === 'you' ? 'rules' : auto.by);
        }
      }
      if (reading.o === 'waiting') {
        reading = { ...reading, on: meta.on ?? reading.on, who: meta.who ?? reading.who, followUpAt: meta.followUpAt ?? reading.followUpAt, next: meta.next ?? reading.next };
      }

      const { shown, all } = linksFor(s, t, prs);
      const brief = getBrief(s.id);
      searchExtra.set(s.id, { linkKeys: all, userTexts: t?.userTexts ?? [], firstPrompt: t?.firstPrompt });

      const last = [t?.lastAssistant && { who: 'Claude', ...t.lastAssistant }, t?.lastUser && { who: 'You', ...t.lastUser }]
        .filter(Boolean)
        .sort((x: any, y: any) => y.at - x.at)[0] as Item['last'];

      const item: Item = {
        id: s.id,
        cliSessionId: cli,
        title: titleFor(t?.customTitle && s.account === 'cli' ? t.customTitle : s.title, prs),
        project: projectKey,
        cwd: s.cwd,
        branch: t?.branch && t.branch !== 'HEAD' ? t.branch : undefined,
        account: s.account,
        archivedInApp: s.archivedBy === 'claude',
        live,
        updatedAt,
        startedAt: t?.startTime ?? s.createdAt,
        last: last ? { who: last.who, text: plain(last.text).slice(0, 600), at: last.at } : undefined,
        lastPrompt: t?.lastPrompt?.slice(0, 600),
        reading,
        auto,
        appSummary: s.summary,
        prs,
        msgs: t?.msgs ?? 0,
        model: t?.model ?? s.model,
        cost: t?.cost,
        linesAdded: t?.linesAdded,
        linesRemoved: t?.linesRemoved,
        act7: activity7(t?.stamps ?? [], now),
        now: t?.now,
        todos: t?.todos ?? [],
        tests: t?.tests,
        notes: meta.notes ?? [],
        summary: brief?.status,
        aiTitle: brief?.v === 2 ? brief.title : undefined,
        about: brief?.v === 2 ? brief.about : undefined,
        task: t?.firstPrompt ? plain(t.firstPrompt).slice(0, 400) : undefined,
        links: shown.map((h) => toLink(h, prs)),
        images: imagesFor(t, shown),
        snoozeUntil: meta.snoozeUntil && meta.snoozeUntil > now ? meta.snoozeUntil : undefined,
        archived: !!meta.archived || !!s.archivedBy,
        archivedBy: meta.archived ? 'board' : s.archivedBy,
        transcriptPath: path,
      };
      items.push(item);

      // Activity feed: one event per meaningful change, never a flood.
      const prev = snaps.get(item.id);
      const next = sig(item);
      if (prev === next) continue;
      putSnapshot(item.id, next);
      const [po, pk, plive, plast, pprs] = (prev ?? '').split('|');
      const warming = now - BOOT_AT < WARMUP_MS;
      if (!prev || (warming && item.last && `${item.last.at}` === plast)) {
        if (prev) continue;
        if (item.last) addEvent(item.id, item.last.at, `${item.last.who}: “${item.last.text.slice(0, 140)}”`, item.reading.o, 'transcript');
        continue;
      }
      if (item.last && `${item.last.at}` !== plast) {
        addEvent(item.id, item.last.at, `${item.last.who}: “${item.last.text.slice(0, 140)}”`, null, 'transcript');
        if (auto.by !== 'you') countReading(auto.by === 'app' ? 'app' : 'rules');
      }
      if (item.live !== plive && item.live === 'running') addEvent(item.id, now, 'Claude started working', 'progress', 'hook');
      if (item.live !== plive && item.live === 'input') addEvent(item.id, now, 'Claude is asking for permission', 'decision', 'hook');
      const prsNow = item.prs.map((p) => `${p.n}:${p.state}`).join(',');
      if (prsNow !== pprs) {
        for (const pr of item.prs) if (!pprs?.includes(`${pr.n}:${pr.state}`)) addEvent(item.id, now, `PR #${pr.n} is ${pr.state}${pr.title ? `: ${pr.title}` : ''}`, null, 'github');
      }
      if (item.reading.o !== po || item.reading.kind !== pk) {
        const label = item.reading.o === 'waiting' ? `Waiting on ${item.reading.on ?? 'others'}` : OUT_LABEL[item.reading.o];
        addEvent(item.id, now, `Read as ${label}${item.reading.kind && item.reading.o !== 'waiting' ? ` · ${item.reading.kind}` : ''}`, item.reading.o, item.reading.by === 'you' ? 'you' : item.reading.by);
      }
    }
  });

  indexItems(items, searchExtra);
  lastState = {
    now,
    items,
    projects: [...projects.values()],
    // The page no longer shows an activity feed; events are still recorded.
    feed: [],
    meter: meterToday(),
    sources: { desktopSessions: sources.filter((s) => !s.id.startsWith('cli:')).length, transcripts, liveSessions: registry.size, github: githubEnabled(), hooks: hooksSeen },
  };
  version++;
  return lastState;
}

export function state(): State {
  return lastState ?? build();
}
