import { STALE_MS } from './config.js';
import type { LiveState, PullRequest, Reading, WaitingOn } from './types.js';

/**
 * Turns what we know about a conversation into one of four outcomes.
 * Order: live state, the desktop app's own post-turn summary, then rules over the last message.
 * Every path here is local and costs 0 tokens.
 */
export interface ReaderInput {
  live: LiveState;
  summary?: { status?: string; detail?: string; needs?: string };
  lastAssistant?: { text: string; at: number };
  lastUser?: { text: string; at: number };
  prs: PullRequest[];
  updatedAt: number;
  now: number;
}

/** Work touched this recently is still active, even if Claude's last turn "completed". */
const ACTIVE_MS = 24 * 60 * 60 * 1000;
/** A merge or "done" message this fresh usually means you're wrapping up. */
const FRESH_MS = 6 * 60 * 60 * 1000;
const PLEASANTRY = /\b(anything else|any other questions?|let me know if|let me know whether|hope (this|that) helps|happy to help|feel free to)\b/i;
const APPROVAL = /\b(approve|approval|permission|allow|ok to run|okay to run|can i (run|push|merge|deploy|delete)|shall i (run|push|merge|deploy)|should i (merge|push|deploy))\b/i;
const DEPENDENCY = /\b(waiting (for|on)|blocked (by|on)|once (the |our |your )?[\w-]+ (team )?(sends?|deploys?|provides?|approves?|ships?|merges?|confirms?|signs? off)|until (the |our |your )?[\w-]+ (team )?(deploys?|sends?|approves?|ships?|confirms?)|needs? .{0,50}\bfrom (the |our |your )?[\w-]+|sent .{0,50}\bto (the )?(client|customer|designer|design team|qa|backend|reviewer|team|pm)|asked (qa|the client|the designer|backend|the backend|the pm)|pending (review|approval|sign-?off))\b/i;
const DONE = /(nothing (else )?(is )?(pending|left|outstanding)|all set\b|\bcomplete[d]?\b|\bdeployed\b|\bshipped\b|merged into|\bfinished\b|\bresolved\b|all (tests|checks) pass)/i;
/** Stricter dependency wording for Claude's own messages, which often *describe* waiting rather than *being* blocked. */
const DEPENDENCY_STRICT = /\b((i('m| am)|we('re| are)) (still )?waiting (for|on)|blocked (by|on|until)|can('|no)t .{0,40}\buntil|once (the |your |our )?[\w-]+ (team )?(sends?|deploys?|provides?|approves?|ships?|merges?|confirms?|signs? off)|needs? .{0,40}\bfrom (the |your |our )?(client|customer|designer|design team|backend|qa|team|pm|reviewer)|sent .{0,50}\bto (the )?(client|customer|designer|design team|qa|backend|reviewer|pm)|pending (code )?(review|approval|sign-?off))/i;
/** Claude asking you to do something, without a question mark. */
const ASK_USER = /\b(please|can you|could you|you('ll| will) need to|you need to)\s+(check|review|test|confirm|try|verify|look at|approve|upload|provide|send|run|restart|merge|share)\b/i;
const ERROR = /^(api error|failed to authenticate|request timed out|overloaded|claude ai usage limit|.*\b(rate limit|usage limit) (reached|exceeded)|error: )/i;
const THANKS = /\b(thanks|thank you|thx|lgtm|looks good|looks great|perfect|awesome|great job)\b/i;

const WHO: Array<[WaitingOn, RegExp]> = [
  ['rev', /\b(code review|reviewers?|review request|approve the pr|pr review)\b/i],
  ['qa', /\b(qa|retest|testers?)\b/i],
  ['design', /\b(designers?|design team|figma|mockups?|illustrations?|photographer|assets?)\b/i],
  ['client', /\b(client|customer|pm|product manager|stakeholders?|sign-?off)\b/i],
  ['be', /\b(backend|back-end|be team|api team|endpoint|server team|staging|deploy)\b/i],
];

function stripCode(text: string) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, (m) => m.slice(1, -1));
}

function sentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function lastParagraph(text: string): string {
  const paras = stripCode(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^[-*#|>]/.test(p));
  return paras[paras.length - 1] ?? '';
}

function clip(s: string, n = 160) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/** The real question at the end of a message, ignoring polite closings like "Anything else?". */
export function trailingQuestion(text: string): string | undefined {
  const tail = sentences(lastParagraph(text)).slice(-3);
  const qs = tail.filter((s) => s.endsWith('?') && !PLEASANTRY.test(s));
  return qs[qs.length - 1];
}

export function waitingOn(text: string): WaitingOn | undefined {
  if (!DEPENDENCY.test(text)) return undefined;
  return WHO.find(([, re]) => re.test(text))?.[0] ?? 'client';
}

function sentenceMatching(text: string, re: RegExp): string | undefined {
  const all = sentences(stripCode(text).replace(/\s+/g, ' '));
  return all.reverse().find((s) => re.test(s));
}

export function read(input: ReaderInput): Reading {
  const { live, summary, lastAssistant: a, lastUser: u, prs, updatedAt, now } = input;
  const idle = now - updatedAt;

  if (live === 'running') {
    return { o: 'progress', kind: 'Claude working', next: 'Nothing needed from you yet', conf: 'high', by: 'rules', evidence: u?.text ? clip(u.text) : undefined, evidenceFrom: 'You' };
  }
  if (live === 'input') {
    return { o: 'decision', kind: 'Approval', next: 'Claude is waiting for your permission', conf: 'high', by: 'rules', evidence: a?.text ? clip(a.text) : undefined, evidenceFrom: 'Claude' };
  }

  // Claude stopped on an error (auth, rate limit, crash): you have to step in.
  if (a && (!u || a.at >= u.at) && ERROR.test(a.text.slice(0, 200))) {
    return { o: 'decision', kind: 'Error', next: 'Claude stopped with an error. Resume the session to retry.', conf: 'high', by: 'rules', evidence: clip(a.text, 220), evidenceFrom: 'Claude' };
  }

  // You spoke last and Claude isn't running.
  if (u && (!a || u.at > a.at)) {
    if (u.text.length < 80 && THANKS.test(u.text)) {
      return { o: 'done', kind: 'Confirmed', next: 'Nothing open', conf: 'high', by: 'rules', evidence: clip(u.text), evidenceFrom: 'You' };
    }
    const on = waitingOn(u.text);
    if (on) return { o: 'waiting', on, kind: '', next: clip(u.text, 120), conf: 'med', by: 'rules', evidence: clip(u.text), evidenceFrom: 'You' };
  }

  // The desktop app's own summary of the last turn (already computed by the app, 0 extra tokens).
  if (summary?.status === 'blocked' && summary.needs) {
    const text = `${summary.needs} ${summary.detail ?? ''}`;
    const on = waitingOn(text);
    if (on) return { o: 'waiting', on, kind: '', next: clip(summary.needs, 140), conf: 'med', by: 'app', evidence: clip(summary.detail || summary.needs), evidenceFrom: 'Claude app summary' };
    return {
      o: 'decision',
      kind: APPROVAL.test(summary.needs) ? 'Approval' : 'Decision',
      next: clip(summary.needs, 160),
      conf: 'high',
      by: 'app',
      evidence: clip(summary.detail || summary.needs),
      evidenceFrom: 'Claude app summary',
    };
  }

  if (a) {
    const q = trailingQuestion(a.text);
    if (q) {
      return { o: 'decision', kind: APPROVAL.test(q) ? 'Approval' : 'Decision', next: clip(q), conf: 'high', by: 'rules', evidence: clip(q, 220), evidenceFrom: 'Claude' };
    }
  }

  if (a) {
    const ask = sentenceMatching(lastParagraph(a.text), ASK_USER);
    if (ask) {
      const kind = /\b(check|review|test|verify|try|look at)\b/i.test(ask) ? 'Review' : APPROVAL.test(ask) ? 'Approval' : 'Decision';
      return { o: 'decision', kind, next: clip(ask), conf: 'high', by: 'rules', evidence: clip(ask, 220), evidenceFrom: 'Claude' };
    }
  }

  // Pull requests.
  const open = prs.filter((p) => p.state === 'open' || p.state === 'draft');
  if (open.length) {
    const p = open[open.length - 1];
    if (p.review === 'changes') return { o: 'decision', kind: 'Reply', next: `Address requested changes on PR #${p.n}`, conf: 'high', by: 'rules', evidence: `PR #${p.n}: changes requested`, evidenceFrom: 'GitHub' };
    if (p.review === 'commented') return { o: 'decision', kind: 'Reply', next: `Answer review comments on PR #${p.n}`, conf: 'med', by: 'rules', evidence: `PR #${p.n} has ${p.comments ?? 'new'} comment(s)`, evidenceFrom: 'GitHub' };
    if (p.review === 'approved' && p.checks !== 'fail') return { o: 'decision', kind: 'Approval', next: `Merge PR #${p.n}?`, conf: 'med', by: 'rules', evidence: `PR #${p.n} is approved`, evidenceFrom: 'GitHub' };
    if (p.state !== 'draft') return { o: 'waiting', on: 'rev', kind: '', next: `Review on PR #${p.n}`, conf: 'med', by: 'rules', evidence: `PR #${p.n} is open${p.checks === 'fail' ? ' with failing checks' : ''}`, evidenceFrom: 'GitHub' };
  } else if (prs.length && prs.every((p) => p.state === 'merged' || p.state === 'closed')) {
    const p = prs[prs.length - 1];
    // Merged a few hours ago and still being talked about: you're probably wrapping up, not done.
    if (idle < FRESH_MS) return { o: 'progress', kind: 'Your turn', next: summary?.detail ? clip(summary.detail, 140) : `PR #${p.n} ${p.state}. Claude finished this step.`, conf: 'med', by: summary?.detail ? 'app' : 'rules', evidence: `PR #${p.n} ${p.state}`, evidenceFrom: 'GitHub' };
    return { o: 'done', kind: p.state === 'merged' ? 'Merged' : 'Closed', next: 'Nothing open', conf: 'high', by: 'rules', evidence: `PR #${p.n} ${p.state}`, evidenceFrom: 'GitHub' };
  }

  if (a && DEPENDENCY_STRICT.test(stripCode(a.text))) {
    const s = sentenceMatching(a.text, DEPENDENCY_STRICT) ?? a.text;
    const on = WHO.find(([, re]) => re.test(s))?.[0] ?? 'client';
    return { o: 'waiting', on, kind: '', next: clip(s, 120), conf: 'med', by: 'rules', evidence: clip(s, 220), evidenceFrom: 'Claude' };
  }

  // Claude finished its turn and asked nothing. Recent: it's your move in active work. Older: it has ended.
  if (summary?.status === 'completed' && !summary.needs) {
    if (idle < ACTIVE_MS) return { o: 'progress', kind: 'Your turn', next: summary.detail ? clip(summary.detail, 140) : 'Claude finished this step', conf: 'med', by: 'app', evidence: clip(summary.detail || a?.text || '', 220), evidenceFrom: 'Claude app summary' };
    if (idle < STALE_MS) return { o: 'done', kind: 'Completed', next: summary.detail ? clip(summary.detail, 140) : 'Nothing asked of you', conf: 'med', by: 'app', evidence: clip(summary.detail || a?.text || '', 220), evidenceFrom: 'Claude app summary' };
  }

  const doneText = [summary?.detail, a?.text].filter(Boolean).join(' ');
  if (doneText && DONE.test(doneText) && idle < FRESH_MS) {
    return { o: 'progress', kind: 'Your turn', next: summary?.detail ? clip(summary.detail, 140) : 'Claude finished this step. Check the result.', conf: 'med', by: summary?.detail ? 'app' : 'rules', evidence: clip(sentenceMatching(doneText, DONE) ?? doneText, 220), evidenceFrom: 'Claude' };
  }
  if (doneText && DONE.test(doneText)) {
    const s = sentenceMatching(doneText, DONE) ?? summary?.detail ?? '';
    return { o: 'done', kind: 'Complete', next: 'Nothing open', conf: 'med', by: summary?.detail && DONE.test(summary.detail) ? 'app' : 'rules', evidence: clip(s, 220), evidenceFrom: summary?.detail && DONE.test(summary.detail) ? 'Claude app summary' : 'Claude' };
  }

  if (idle > STALE_MS) {
    return { o: 'done', kind: 'Looks finished', next: 'Idle for over a week and nothing was asked. Confirm or reopen.', conf: 'low', by: 'rules', evidence: a ? clip(a.text, 220) : summary?.detail, evidenceFrom: 'Claude' };
  }

  return {
    o: 'decision',
    kind: 'Review',
    next: summary?.detail ? clip(summary.detail, 140) : 'Claude finished. Check the result.',
    conf: 'low',
    by: summary?.detail ? 'app' : 'rules',
    evidence: a ? clip(a.text, 220) : summary?.detail,
    evidenceFrom: a ? 'Claude' : 'Claude app summary',
  };
}
