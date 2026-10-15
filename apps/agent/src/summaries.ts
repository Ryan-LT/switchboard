import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { TOKEN_CAP } from './config.js';
import { parseJson, runClaude } from './claude.js';
import { readTranscript, shortAction, userText } from './sources/transcripts.js';
import { countReading, getSummary, meterToday, putSummary } from './store.js';
import type { Item } from './types.js';

/**
 * Each card's title, description and status, written by Sonnet through `claude -p` (your Claude plan, no API key).
 * One conversation at a time, only after it goes quiet, and only when a new message arrived since the last one.
 */

const SYSTEM = `You write the card for one Claude Code conversation on the user's dashboard. They have dozens of chats across projects and get replies from teammates on different issues, so the card must make it obvious, at a glance, which task this chat is about and where it stands.

Return only JSON: {"title": "...", "about": "...", "status": "..."}

- title: the task's topic in at most 60 characters, specific enough to tell it apart from similar chats in the same project. Include the issue or PR number when there is one, e.g. "Invite users without email (#232)". No project name, no "Chat about".
- about: one or two plain sentences, at most 170 characters: what the task is and its scope. Name the feature, screen, endpoint, file or people involved.
- status: at most 90 characters: what the user must do next, or where it stands if nothing is needed. Lead with the action when there is one: Reply "post it" to post the #306 draft · Waiting on BE for /v2/rates · Done, PR #117 merged.

Plain text in every field. No markdown, no quotes around values, no trailing period.`;

const TAIL_BYTES = 600_000;
const MAX_CHARS = 8_000;
const MAX_MSG_CHARS = 1_000;
const QUIET_MS = 20_000;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n * 0.6)} … ${s.slice(-n * 0.3)}`);

/** The last part of the transcript as a plain "You / Claude / tool" log. */
export function conversationTail(path: string): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift(); // first line is cut in half
  const out: string[] = [];
  for (const line of lines) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.isSidechain || d.isMeta) continue;
    if (d.type === 'user' && (!d.origin?.kind || d.origin.kind === 'human')) {
      const text = userText(d.message?.content);
      if (text) out.push(`You: ${clip(text, MAX_MSG_CHARS)}`);
    } else if (d.type === 'assistant' && Array.isArray(d.message?.content)) {
      for (const b of d.message.content) {
        if (b?.type === 'text' && b.text?.trim()) out.push(`Claude: ${clip(b.text.trim(), MAX_MSG_CHARS)}`);
        else if (b?.type === 'tool_use') out.push(`(${shortAction(b.name, b.input)})`);
      }
    }
  }
  return out.join('\n').slice(-MAX_CHARS);
}

/** Longer than this means it was written by an older, wordier prompt. */
export const SUMMARY_MAX = 110;

/** One glanceable line: first sentence, trailing period dropped, cut at a word boundary if still long. */
export function shortSummary(text?: string, max = SUMMARY_MAX): string | undefined {
  if (!text) return undefined;
  let t = text.replace(/\s+/g, ' ').trim().replace(/^["“](.*)["”]$/, '$1');
  const first = t.match(/^(.+?[.!?])(\s|$)/)?.[1];
  if (first && first.length >= 20 && max <= SUMMARY_MAX) t = first;
  t = t.replace(/[.]$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:·-]$/, '') + '…';
}

export interface Brief {
  v: 2;
  title?: string;
  about?: string;
  status?: string;
}

/** Turns Claude's reply into a card; undefined if it isn't usable. */
export function parseBrief(text: string): Brief | undefined {
  const j = parseJson<Record<string, unknown>>(text);
  if (!j) return undefined;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? shortSummary(v, max) : undefined);
  const b: Brief = { v: 2, title: str(j.title, 70), about: str(j.about, 200), status: str(j.status, SUMMARY_MAX) };
  return b.title || b.about || b.status ? b : undefined;
}

/** The stored card. Summaries from the old one-line prompt come back as a status only, and are rewritten. */
export function getBrief(id: string): Brief | { v: 1; status?: string } | undefined {
  const s = getSummary(id);
  if (!s) return undefined;
  if (s.text.startsWith('{')) {
    try {
      const b = JSON.parse(s.text);
      if (b?.v === 2) return b as Brief;
    } catch {
      /* fall through */
    }
  }
  return { v: 1, status: shortSummary(s.text) };
}

function needsBrief(c: Item, now: number) {
  if (c.archived || !c.transcriptPath || !c.last || c.live === 'running') return false;
  if (now - c.last.at < QUIET_MS) return false;
  const s = getSummary(c.id);
  return !s || s.basedOn !== c.last.at || getBrief(c.id)?.v !== 2;
}

let busy = false;
let pausedUntil = 0;

/** Call after every rebuild; `onSaved` schedules the next rebuild so the new card reaches the page. */
export function queueSummaries(items: Item[], onSaved: () => void) {
  const now = Date.now();
  if (busy || now < pausedUntil) return;
  if (meterToday().tokens >= TOKEN_CAP) return;
  // Open conversations first, most recently active first.
  const next = items
    .filter((c) => needsBrief(c, now))
    .sort((a, b) => Number(a.reading.o === 'done') - Number(b.reading.o === 'done') || b.updatedAt - a.updatedAt)[0];
  if (!next) return;
  busy = true;
  const basedOn = next.last!.at;
  const first = readTranscript(next.transcriptPath!)?.firstPrompt;
  const links = next.links
    .filter((l) => l.kind === 'issue' || l.kind === 'pr')
    .map((l) => `${l.label}${l.title ? ` "${l.title}"` : ''}${l.state ? ` (${l.state})` : ''}`)
    .join('; ');
  const input = [
    `Project: ${next.project}`,
    `Chat title in the Claude app: ${next.title}`,
    links && `Linked: ${links}`,
    first && `\n<first-request>\n${clip(first, 1500)}\n</first-request>`,
    `\n<recent>\n${conversationTail(next.transcriptPath!)}\n</recent>`,
  ]
    .filter(Boolean)
    .join('\n');
  runClaude(SYSTEM, input)
    .then(({ text, tokens }) => {
      countReading('ai', tokens);
      const brief = parseBrief(text);
      // An unusable reply is still recorded against this message, so the same chat isn't retried in a loop.
      putSummary(next.id, { text: JSON.stringify(brief ?? { v: 2, status: shortSummary(text) }), basedOn, at: Date.now() });
    })
    .catch((e) => {
      // ponytail: one fixed 10-minute back-off for any failure (logged out, usage limit, missing CLI).
      pausedUntil = Date.now() + 10 * 60_000;
      console.error(`[switchboard] card writer failed, retrying in 10 min: ${String(e.message).slice(0, 200)}`);
    })
    .finally(() => {
      busy = false;
      onSaved();
    });
}
