import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECTS_DIR } from '../config.js';
import { saveChatImage } from '../images.js';
import { classify, ghCommandRefs, linksIn, note, shortRefs, type LinkHit } from '../links.js';

/** What Switchboard keeps from a transcript. Built incrementally: only new bytes are read. */
export interface TranscriptInfo {
  path: string;
  offset: number;
  size: number;
  lastAssistant?: { text: string; at: number };
  lastUser?: { text: string; at: number };
  lastPrompt?: string;
  customTitle?: string;
  cwd?: string;
  branch?: string;
  model?: string;
  msgs: number;
  cost?: number;
  linesAdded?: number;
  linesRemoved?: number;
  startTime?: number;
  prLinks: Array<{ n: number; repo: string; url: string }>;
  now?: string;
  nowAt?: number;
  todos: Array<[string, boolean]>;
  tests?: { passed: number; total: number };
  /** Message timestamps (epoch ms) of human prompts and assistant replies, for the 7-day activity chart. */
  stamps: number[];
  /** Hash of the last message; a reading is never recomputed for the same hash. */
  lastHash?: string;
  pendingTests: Map<string, string>;
  /** Your first message: the original ask. */
  firstPrompt?: string;
  /** Your last few messages, for search. */
  userTexts: string[];
  /** Issues, PRs, Figma files and threads mentioned in the conversation. */
  links: Map<string, LinkHit>;
  /** "#232" style numbers, resolved against the folder's GitHub repo later. */
  refs: Map<number, { count: number; kind?: 'pr' | 'issue'; byUser: boolean; touched: boolean; firstAt: number }>;
  /** Screenshots you pasted, oldest first. */
  images: Array<{ id: string; at: number; caption?: string }>;
}

const index = new Map<string, string>();
const infos = new Map<string, TranscriptInfo>();

/** Maps CLI session id -> transcript path. Cheap: two readdir levels. */
export function refreshIndex(): number {
  index.clear();
  let dirs: string[] = [];
  try {
    dirs = readdirSync(PROJECTS_DIR);
  } catch {
    return 0;
  }
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = readdirSync(join(PROJECTS_DIR, dir));
    } catch {
      continue;
    }
    for (const f of files) if (f.endsWith('.jsonl') && !f.startsWith('agent-')) index.set(f.slice(0, -6), join(PROJECTS_DIR, dir, f));
  }
  return index.size;
}

export function transcriptPath(sessionId: string): string | undefined {
  return index.get(sessionId);
}

export function indexEntries(): Array<[string, string]> {
  return [...index.entries()];
}

const SYSTEM_TAG = /^<(system-reminder|command-|local-command|task-notification|user-prompt-submit-hook)/;

export function userText(content: unknown): string {
  if (typeof content === 'string') return SYSTEM_TAG.test(content.trim()) ? '' : content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string' && !SYSTEM_TAG.test(b.text.trim()))
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}

export function shortAction(name: string, input: any): string {
  if (!input || typeof input !== 'object') return name;
  if (name === 'Bash' && input.command) return `Ran ${String(input.command).split('\n')[0].slice(0, 70)}`;
  if ((name === 'Edit' || name === 'Write' || name === 'Read') && input.file_path) {
    const parts = String(input.file_path).split('/');
    return `${name === 'Read' ? 'Read' : name === 'Write' ? 'Wrote' : 'Edited'} ${parts.slice(-2).join('/')}`;
  }
  if (name.startsWith('mcp__')) return `Used ${name.split('__').slice(1).join(' ').replace(/_/g, ' ')}`;
  return `Used ${name}`;
}

const TEST_CMD = /\b(test|vitest|jest|playwright|pytest|mocha|spec)\b/i;

function parseTests(text: string): { passed: number; total: number } | undefined {
  const passed = text.match(/(\d+)\s+passed/i);
  if (!passed) return undefined;
  const failed = text.match(/(\d+)\s+failed/i);
  const p = Number(passed[1]);
  const f = failed ? Number(failed[1]) : 0;
  return { passed: p, total: p + f };
}

function apply(info: TranscriptInfo, d: any) {
  const at = d.timestamp ? Date.parse(d.timestamp) : undefined;
  if (d.gitBranch) info.branch = d.gitBranch;
  if (d.cwd && !info.cwd) info.cwd = d.cwd;
  switch (d.type) {
    case 'custom-title':
      if (d.customTitle) info.customTitle = d.customTitle;
      return;
    case 'last-prompt':
      if (d.lastPrompt) info.lastPrompt = String(d.lastPrompt);
      return;
    case 'cost-state':
      info.cost = d.totalCostUSD;
      info.linesAdded = d.totalLinesAdded;
      info.linesRemoved = d.totalLinesRemoved;
      info.startTime = d.startTime;
      return;
    case 'pr-link':
      if (d.prNumber && !info.prLinks.some((p) => p.n === d.prNumber && p.repo === d.prRepository)) {
        info.prLinks.push({ n: d.prNumber, repo: d.prRepository, url: d.prUrl });
      }
      if (d.prNumber && d.prRepository) {
        const l = classify(`https://github.com/${d.prRepository}/pull/${d.prNumber}`);
        if (l) note(info.links, l, at ?? 0, { touched: true });
      }
      return;
    case 'assistant': {
      if (d.isSidechain) return;
      const m = d.message;
      if (m?.model) info.model = m.model;
      if (!Array.isArray(m?.content)) return;
      const text = m.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim();
      if (text && at) {
        for (const l of linksIn(text)) note(info.links, l, at, {});
        info.lastAssistant = { text, at };
        info.msgs++;
        info.stamps.push(at);
        info.lastHash = hash('a' + text);
      }
      for (const b of m.content) {
        if (b?.type !== 'tool_use') continue;
        info.now = shortAction(b.name, b.input);
        info.nowAt = at;
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
          info.todos = b.input.todos.map((t: any) => [String(t.content ?? t.activeForm ?? ''), t.status === 'completed'] as [string, boolean]);
        }
        if (b.name === 'Bash' && TEST_CMD.test(String(b.input?.command ?? ''))) info.pendingTests.set(b.id, b.input.command);
        if (b.name === 'Bash' && typeof b.input?.command === 'string' && /\bgh\s+(issue|pr)\b/.test(b.input.command)) {
          for (const r of ghCommandRefs(b.input.command)) {
            if (r.repo) {
              const l = classify(`https://github.com/${r.repo}/${r.kind === 'pr' ? 'pull' : 'issues'}/${r.n}`);
              if (l) note(info.links, l, at ?? 0, { touched: true });
            } else addRef(info, r.n, r.kind as 'pr' | 'issue', at ?? 0, { touched: true });
          }
          // URLs only from the gh command itself, not from file contents written in the same command.
          for (const part of b.input.command.split(/\n|&&|\|\||;/)) if (/^\s*gh\s+(issue|pr|browse)\b/.test(part)) for (const l of linksIn(part)) note(info.links, l, at ?? 0, { touched: true });
        }
      }
      return;
    }
    case 'user': {
      if (d.isSidechain || d.isMeta) return;
      const content = d.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === 'tool_result' && info.pendingTests.has(b.tool_use_id)) {
            info.pendingTests.delete(b.tool_use_id);
            const raw = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => x?.text ?? '').join('\n') : '';
            const t = parseTests(raw);
            if (t) info.tests = t;
          }
        }
      }
      if (d.origin?.kind && d.origin.kind !== 'human') return;
      const text = userText(content);
      if (Array.isArray(content) && at) {
        for (const b of content) {
          if (b?.type !== 'image' || b.source?.type !== 'base64' || typeof b.source.data !== 'string') continue;
          const id = saveChatImage(b.source.data, b.source.media_type);
          if (id && !info.images.some((i) => i.id === id)) info.images.push({ id, at, caption: text ? text.replace(/\s+/g, ' ').slice(0, 160) : undefined });
        }
      }
      if (text && at) {
        if (!info.firstPrompt) info.firstPrompt = text.slice(0, 2000);
        info.userTexts.push(text.slice(0, 600));
        if (info.userTexts.length > 8) info.userTexts.shift();
        for (const l of linksIn(text)) note(info.links, l, at, { byUser: true });
        for (const r of shortRefs(text)) addRef(info, r.n, r.kind as 'pr' | 'issue' | undefined, at, { byUser: true });
        info.lastUser = { text, at };
        info.msgs++;
        info.stamps.push(at);
        info.lastHash = hash('u' + text);
      }
      return;
    }
  }
}

function addRef(info: TranscriptInfo, n: number, kind: 'pr' | 'issue' | undefined, at: number, how: { byUser?: boolean; touched?: boolean }) {
  const r = info.refs.get(n);
  if (r) {
    r.count++;
    r.kind ??= kind;
    r.byUser ||= !!how.byUser;
    r.touched ||= !!how.touched;
  } else info.refs.set(n, { count: 1, kind, byUser: !!how.byUser, touched: !!how.touched, firstAt: at });
}

function hash(s: string) {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

/** Reads only the bytes appended since the last call. Safe to call on every change. */
export function readTranscript(path: string): TranscriptInfo | undefined {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return infos.get(path);
  }
  let info = infos.get(path);
  if (!info || size < info.offset) {
    info = { path, offset: 0, size: 0, msgs: 0, prLinks: [], todos: [], stamps: [], pendingTests: new Map(), userTexts: [], links: new Map(), refs: new Map(), images: [] };
    infos.set(path, info);
  }
  if (size === info.offset) return info;
  const fd = openSync(path, 'r');
  try {
    const len = size - info.offset;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, info.offset);
    // Only parse up to the last complete line; a half-written line is picked up next time.
    const lastNl = buf.lastIndexOf(10);
    if (lastNl < 0) return info;
    for (const line of buf.subarray(0, lastNl).toString('utf8').split('\n')) {
      if (!line) continue;
      try {
        apply(info, JSON.parse(line));
      } catch {
        /* skip malformed line */
      }
    }
    info.offset += lastNl + 1;
    info.size = size;
    if (info.stamps.length > 2000) info.stamps = info.stamps.slice(-2000);
  } finally {
    closeSync(fd);
  }
  return info;
}

export function activity7(stamps: number[], now = Date.now()): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - 6 * 86400000;
  for (const t of stamps) {
    if (t < start) continue;
    const i = Math.min(6, Math.floor((t - start) / 86400000));
    out[i]++;
  }
  return out;
}
