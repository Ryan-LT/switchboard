import { createHash } from 'node:crypto';
import { parseJson, runClaude } from './claude.js';
import { linksIn, shortRefs } from './links.js';
import { ghInfo, ghInfoNow } from './sources/github.js';
import { countReading } from './store.js';
import type { Item, SearchHit } from './types.js';

/**
 * Finding the chat a message belongs to.
 * 1. Links first: a pasted issue, PR, Figma or Slack link that a chat already mentions is a certain match.
 * 2. Words: a BM25 ranking over each chat's title, description, first ask and your recent messages. Instant, no tokens.
 * 3. Claude: on request, Sonnet reads a compact card of every chat and picks the ones to continue in, with a reason.
 */

/** What search knows about a chat beyond the card: every link key and your recent messages. */
export interface SearchExtra {
  linkKeys: Set<string>;
  userTexts: string[];
  firstPrompt?: string;
}

const extras = new Map<string, SearchExtra>();
let docs: Array<{ id: string; tf: Map<string, number>; len: number }> = [];
let df = new Map<string, number>();
let avgLen = 1;

const STOP = new Set(
  'the and for are but not you your yours with this that these those from have has had was were will would can could should may might into onto about over under then than them they their there here what when where which who whom why how all any both each few more most other some such only own same too very just also its our out off per via get got let lets make made use used using need needs want wants please thanks thank hey hi hello okay yes now new one two see did does done doing like know think sure still already again any its it\'s i\'m we\'re don\'t can\'t won\'t'.split(' '),
);

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (let w of text.toLowerCase().split(/[^a-z0-9#]+/)) {
    w = w.replace(/^#/, '');
    if (!w || STOP.has(w)) continue;
    if (/^\d+$/.test(w)) {
      if (w.length >= 2) out.push(w);
      continue;
    }
    if (w.length < 3) continue;
    // Light stemming so "invitations" finds "invitation".
    if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
    else if (w.length > 4 && w.endsWith('es') && /(ss|sh|ch|x)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

const fieldsOf = (c: Item, x?: SearchExtra): Array<[string, number]> => [
  [c.aiTitle ?? '', 3],
  [c.title, 3],
  [c.about ?? '', 2],
  [x?.firstPrompt?.slice(0, 1500) ?? c.task ?? '', 1.5],
  [c.summary ?? '', 1],
  [c.links.map((l) => `${l.label} ${l.title ?? ''}`).join(' '), 2],
  [c.branch?.replace(/[-_/]/g, ' ') ?? '', 1],
  [c.project, 0.5],
  [(x?.userTexts ?? []).join(' '), 1],
];

/** Rebuilt after every state build; cheap (a few ms for a hundred chats). */
export function indexItems(items: Item[], extra: Map<string, SearchExtra>) {
  extras.clear();
  for (const [k, v] of extra) extras.set(k, v);
  df = new Map();
  docs = items.map((c) => {
    const tf = new Map<string, number>();
    let len = 0;
    for (const [text, w] of fieldsOf(c, extra.get(c.id))) {
      for (const t of tokens(text)) {
        tf.set(t, (tf.get(t) ?? 0) + w);
        len += w;
      }
    }
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { id: c.id, tf, len };
  });
  avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length) || 1;
}

/** Links and issue numbers in the query, as the keys chats are indexed by. */
export function queryRefs(q: string): Array<{ key?: string; n?: number; label: string; repo?: string }> {
  const out: Array<{ key?: string; n?: number; label: string; repo?: string }> = linksIn(q).map((l) => ({ key: l.key, label: l.label, n: l.n, repo: l.repo }));
  for (const r of shortRefs(q)) if (!out.some((o) => o.n === r.n)) out.push({ n: r.n, label: `#${r.n}` });
  return out;
}

/** Instant ranking: shared links first, then BM25 over words. */
export function localSearch(q: string, items: Item[], limit = 12): SearchHit[] {
  const byId = new Map(items.map((c) => [c.id, c]));
  const hits = new Map<string, SearchHit>();
  for (const ref of queryRefs(q)) {
    for (const [id, x] of extras) {
      const keys = [...x.linkKeys];
      const match = ref.key ? x.linkKeys.has(ref.key) : ref.n !== undefined && keys.some((k) => k.startsWith('gh:') && k.endsWith(`#${ref.n}`));
      if (match && byId.has(id)) hits.set(id, { id, via: 'link', why: `Mentions ${ref.label}`, score: 1000 + (byId.get(id)!.updatedAt / 1e13) });
    }
  }
  // Words from the query, plus the title of a pasted GitHub issue or PR when it's already known.
  let text = q.replace(/https?:\/\/\S+/g, ' ');
  for (const ref of queryRefs(q)) if (ref.repo && ref.n) text += ` ${ghInfo(ref.repo, ref.n)?.title ?? ''}`;
  const terms = [...new Set(tokens(text))];
  const N = docs.length;
  for (const d of docs) {
    let score = 0;
    const why: Array<[string, number]> = [];
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      const s = (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / avgLen)));
      score += s;
      why.push([t, s]);
    }
    if (score < 1.2) continue;
    const prev = hits.get(d.id);
    if (prev) prev.score += score;
    else {
      const top = why.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => `“${t}”`);
      hits.set(d.id, { id: d.id, via: 'words', why: `Matches ${top.join(', ')}`, score });
    }
  }
  // Weak word matches (one common word) are noise next to a strong one: keep those at least 30% as strong as the best.
  const best = Math.max(0, ...[...hits.values()].filter((h) => h.via === 'words').map((h) => h.score));
  return [...hits.values()]
    .filter((h) => h.via === 'link' || h.score >= best * 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const SYSTEM = `You help the user find which of their Claude Code chats an incoming message belongs to. The message may be a teammate's reply, a pasted issue or PR link (with its description), an error, or a short description of a task. The user wants to resume the right chat instead of re-reading old ones.

Pick the chats where the user should continue this work: same issue or PR, same feature, screen, endpoint, bug, file or people. Shared issue/PR numbers and specific names beat generic topic overlap. When two chats fit equally, prefer the one still in progress and more recently active.

Return only JSON: {"matches":[{"n":<chat number>,"why":"<at most 110 characters, concrete: what links the message to this chat>","confidence":"high|med|low"}]}
At most 4 matches, best first. Return {"matches":[]} when nothing fits. Never invent chat numbers.`;

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const one = (s: string | undefined, n: number) => (s ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

function candidateCard(i: number, c: Item, now: number): string {
  const x = extras.get(c.id);
  const links = c.links.map((l) => `${l.label}${l.title ? ` "${one(l.title, 70)}"` : ''}${l.state ? ` (${l.state})` : ''}`).join('; ');
  return [
    `[${i}] ${c.project} · active ${ago(now - c.updatedAt)}${c.archived ? ` · archived${c.archivedBy === 'claude' ? ' in the Claude app' : c.archivedBy === 'age' ? ' (old terminal chat)' : ''}` : ''}${c.reading.o === 'done' ? ' · finished' : ''}`,
    `title: ${one(c.aiTitle ?? c.title, 90)}${c.aiTitle && c.aiTitle !== c.title ? ` (app title: ${one(c.title, 50)})` : ''}`,
    c.about && `about: ${one(c.about, 200)}`,
    c.summary && `status: ${one(c.summary, 110)}`,
    links && `links: ${links}`,
    c.branch && `branch: ${c.branch}`,
    `first ask: ${one(x?.firstPrompt ?? c.task, 260)}`,
    x?.userTexts.length ? `latest from user: ${one(x.userTexts[x.userTexts.length - 1], 180)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const aiCache = new Map<string, { at: number; result: AiResult }>();
const aiInflight = new Map<string, Promise<AiResult>>();

export interface AiResult {
  hits: SearchHit[];
  ms: number;
  tokens: number;
  considered: number;
}

/** Sonnet picks the chats to continue in. Results are cached for 10 minutes per query. */
export function aiSearch(q: string, items: Item[]): Promise<AiResult> {
  const key = createHash('sha1').update(q.trim()).digest('hex');
  const hit = aiCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return Promise.resolve(hit.result);
  const running = aiInflight.get(key);
  if (running) return running;
  const job = runAi(q, items)
    .then((result) => {
      aiCache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => aiInflight.delete(key));
  aiInflight.set(key, job);
  return job;
}

async function runAi(q: string, items: Item[]): Promise<AiResult> {
  const now = Date.now();
  // Every chat on the board, plus archived ones (here, in the Claude app, or old terminal chats): those that share
  // a link or words with the message first, then the most recent, so a chat archived too early is still found.
  const open = items.filter((c) => !c.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  const archived = items.filter((c) => c.archived)
  const archivedIds = new Set(archived.map((c) => c.id))
  const related = new Set(localSearch(q, items, 80).filter((h) => archivedIds.has(h.id)).slice(0, 25).map((h) => h.id))
  const byRelevance = [...archived.filter((c) => related.has(c.id)), ...archived.filter((c) => !related.has(c.id)).sort((a, b) => b.updatedAt - a.updatedAt)]
  const pool = [...open, ...byRelevance].slice(0, Math.max(90, open.length + 25))
  // A pasted GitHub link is read first, so Claude matches on what the issue says, not just its number.
  const linked: string[] = [];
  for (const ref of queryRefs(q).slice(0, 3)) {
    if (!ref.repo || !ref.n) continue;
    const info = await ghInfoNow(ref.repo, ref.n);
    if (info?.title) linked.push(`${info.isPr ? 'PR' : 'Issue'} #${ref.n} in ${ref.repo}: "${info.title}" (${info.state})${info.body ? `\n${info.body.slice(0, 900)}` : ''}`);
  }
  const input = [
    `<message>\n${q.trim().slice(0, 4000)}\n</message>`,
    linked.length && `<linked>\n${linked.join('\n\n')}\n</linked>`,
    `<chats>\n${pool.map((c, i) => candidateCard(i + 1, c, now)).join('\n\n')}\n</chats>`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const { text, tokens: used, ms } = await runClaude(SYSTEM, input, { timeoutMs: 90_000 });
  countReading('ai', used);
  const j = parseJson<{ matches?: Array<{ n?: number; why?: string; confidence?: string }> }>(text);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const m of j?.matches ?? []) {
    const c = typeof m.n === 'number' ? pool[m.n - 1] : undefined;
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    const confidence = m.confidence === 'high' || m.confidence === 'low' ? m.confidence : 'med';
    hits.push({ id: c.id, via: 'ai', why: one(m.why, 140) || 'Picked by Claude', confidence, score: 100 - hits.length });
  }
  return { hits, ms, tokens: used, considered: pool.length };
}
