import { execFileSync } from 'node:child_process';
import type { LinkKind } from './types.js';

/** A link found in a conversation, before GitHub details are attached. */
export interface LinkHit {
  key: string;
  kind: LinkKind;
  url: string;
  label: string;
  repo?: string;
  n?: number;
  count: number;
  /** You pasted or typed it (as opposed to Claude mentioning it). */
  byUser: boolean;
  /** Claude opened or created it (gh issue view, gh pr create, a PR link record). */
  touched: boolean;
  firstAt: number;
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]}|\\]+/g;
const TRAIL = /[.,;:!?*'"]+$/;

const GH = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/i;
const FIGMA = /^https?:\/\/(?:www\.)?figma\.com\/(design|file|proto|board|make)\/([A-Za-z0-9]+)(?:\/([^?#]*))?(?:\?([^#]*))?/i;
const SLACK = /^https?:\/\/([\w-]+)\.slack\.com\/archives\/([A-Z0-9]+)(?:\/p(\d+))?/i;
const JIRA = /^https?:\/\/[\w-]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/;
const LINEAR = /^https?:\/\/linear\.app\/[\w-]+\/issue\/([A-Z][A-Z0-9]*-\d+)/i;
const TRELLO = /^https?:\/\/trello\.com\/c\/([A-Za-z0-9]+)(?:\/[\w-]*)?/;
const NOTION = /^https?:\/\/(?:www\.)?notion\.so\/[^\s?#]+/;

export const ghKey = (repo: string, n: number) => `gh:${repo.toLowerCase()}#${n}`;

/** Recognises the links worth showing on a card; everything else (docs, localhost, previews) is ignored. */
export function classify(raw: string): Omit<LinkHit, 'count' | 'byUser' | 'touched' | 'firstAt'> | undefined {
  const url = raw.replace(TRAIL, '');
  let m = url.match(GH);
  if (m) {
    const repo = `${m[1]}/${m[2]}`;
    const n = Number(m[4]);
    const kind: LinkKind = m[3].toLowerCase() === 'pull' ? 'pr' : 'issue';
    return { key: ghKey(repo, n), kind, url: `https://github.com/${repo}/${m[3].toLowerCase()}/${n}`, label: `${kind === 'pr' ? 'PR' : 'Issue'} #${n}`, repo, n };
  }
  if ((m = url.match(FIGMA))) {
    const params = new URLSearchParams(m[4] ?? '');
    const node = params.get('node-id') ?? '';
    const name = decodeURIComponent(m[3] ?? '').replace(/[-_]+/g, ' ').trim();
    const clean = `https://www.figma.com/${m[1]}/${m[2]}${m[3] ? `/${m[3]}` : ''}${node ? `?node-id=${node}` : ''}`;
    return { key: `figma:${m[2]}:${node}`, kind: 'figma', url: clean, label: name ? `Figma · ${name.slice(0, 40)}` : 'Figma' };
  }
  if ((m = url.match(SLACK))) {
    const clean = `https://${m[1]}.slack.com/archives/${m[2]}${m[3] ? `/p${m[3]}` : ''}`;
    return { key: `slack:${m[2]}:${m[3] ?? ''}`, kind: 'slack', url: clean, label: m[3] ? 'Slack thread' : 'Slack channel' };
  }
  if ((m = url.match(JIRA))) return { key: `jira:${m[1]}`, kind: 'jira', url, label: m[1] };
  if ((m = url.match(LINEAR))) return { key: `linear:${m[1].toUpperCase()}`, kind: 'linear', url, label: m[1].toUpperCase() };
  if ((m = url.match(TRELLO))) return { key: `trello:${m[1]}`, kind: 'trello', url: m[0], label: 'Trello card' };
  if ((m = url.match(NOTION))) return { key: `notion:${m[0]}`, kind: 'notion', url: m[0], label: 'Notion page' };
  return undefined;
}

export function linksIn(text: string) {
  const out: Array<NonNullable<ReturnType<typeof classify>>> = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const l = classify(raw);
    if (l) out.push(l);
  }
  return out;
}

/** `gh issue view 232 -R owner/repo`, `gh pr create …` and friends: issues and PRs Claude actually worked on. */
const GH_CMD = /\bgh\s+(issue|pr)\s+(view|comment|edit|checkout|diff|close|reopen|merge|review|ready|checks)\b(.*)/;

export function ghCommandRefs(command: string): Array<{ kind: LinkKind; n: number; repo?: string }> {
  const out: Array<{ kind: LinkKind; n: number; repo?: string }> = [];
  for (const part of command.split(/\n|&&|\|\||;|\|/)) {
    const m = part.match(GH_CMD);
    if (!m) continue;
    const n = m[3].match(/(?:^|\s)#?(\d{1,6})(?=\s|$)/)?.[1];
    if (!n) continue;
    out.push({ kind: m[1] === 'pr' ? 'pr' : 'issue', n: Number(n), repo: m[3].match(/(?:-R|--repo)[ =]([\w.-]+\/[\w.-]+)/)?.[1] });
  }
  return out;
}

/** "issue 232", "PR #302", "#1841": numbers you wrote. Bare "#n" needs at least two digits so "#1 priority" is not a link. */
const SHORT_REF = /(?:\b(issue|ticket|pr|pull request)\s*#?(\d{1,6})\b)|(?:(?:^|[\s(])#(\d{2,6})\b)/gi;

export function shortRefs(text: string): Array<{ n: number; kind?: LinkKind }> {
  const out: Array<{ n: number; kind?: LinkKind }> = [];
  for (const m of text.matchAll(SHORT_REF)) {
    if (m[2]) out.push({ n: Number(m[2]), kind: /^p/i.test(m[1]) ? 'pr' : 'issue' });
    else if (m[3]) out.push({ n: Number(m[3]) });
  }
  return out;
}

const remotes = new Map<string, string | undefined>();

/** owner/repo of the folder's GitHub remote, or undefined. Cached per folder. */
export function repoFor(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  if (remotes.has(cwd)) return remotes.get(cwd);
  let repo: string | undefined;
  try {
    const url = execFileSync('git', ['-C', cwd, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    repo = url.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
  } catch {
    repo = undefined;
  }
  remotes.set(cwd, repo);
  return repo;
}

/** Adds one sighting of a link to a conversation's set. */
export function note(map: Map<string, LinkHit>, l: Omit<LinkHit, 'count' | 'byUser' | 'touched' | 'firstAt'>, at: number, how: { byUser?: boolean; touched?: boolean }) {
  const hit = map.get(l.key);
  if (hit) {
    hit.count++;
    hit.byUser ||= !!how.byUser;
    hit.touched ||= !!how.touched;
    // A PR link beats an issue link for the same number (GitHub redirects /issues/n to the PR).
    if (l.kind === 'pr' && hit.kind === 'issue') Object.assign(hit, { kind: 'pr', url: l.url, label: l.label });
    return;
  }
  map.set(l.key, { ...l, count: 1, byUser: !!how.byUser, touched: !!how.touched, firstAt: at });
}

/** The links a card shows: things you shared or Claude worked on, plus anything mentioned repeatedly. */
export function relevantLinks(hits: LinkHit[], limit = 6): LinkHit[] {
  const weight = (h: LinkHit) => (h.touched ? 4 : 0) + (h.byUser ? 3 : 0) + Math.min(h.count, 6) * 0.5 + (h.kind === 'pr' || h.kind === 'issue' ? 1 : 0);
  return hits
    .filter((h) => h.byUser || h.touched || h.count >= 2)
    .sort((a, b) => weight(b) - weight(a) || a.firstAt - b.firstAt)
    .slice(0, limit);
}
