import { basename } from 'node:path';
import type { Project } from './types.js';

const GROUPS: Record<string, string> = { dcg: 'DCG', psp: 'PSP', freelance: 'Freelance', personal: 'Personal' };
export const ICONS = ['wind', 'box', 'bag', 'coin', 'sparkle', 'heart', 'grid', 'home', 'briefcase', 'calendar', 'trend', 'bars', 'file', 'mountain', 'book', 'rocket'];
export const HUES = ['blue', 'orange', 'rose', 'green', 'violet', 'pink', 'indigo', 'olive', 'teal', 'cyan', 'brown', 'slate'];

const KEYWORD_ICONS: Array<[RegExp, string]> = [
  [/wedding|love|heart/, 'heart'],
  [/saving|wealth|money|finance|bank|pay/, 'coin'],
  [/market|shop|store|commerce/, 'bag'],
  [/career|job|role|hire|recruit/, 'briefcase'],
  [/calendar|schedul|book/, 'calendar'],
  [/analytic|report|export|chart/, 'bars'],
  [/rebrand|design|web|site/, 'sparkle'],
  [/quote|doc|pdf|brand/, 'file'],
  [/admin|dashboard|switchboard/, 'grid'],
  [/breeze|wind|air/, 'wind'],
  [/acme|portal|box|package/, 'box'],
  [/tracker|trend|growth/, 'trend'],
];

function hashIndex(s: string, n: number) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

/** Where a session's working folder belongs. Scratch workspaces become "No folder"; worktrees roll up into their repo. */
export function projectFor(cwd: string, gitRoot?: string): Omit<Project, 'icon' | 'hue'> {
  if (cwd.includes('/scratch-workspaces/')) return { key: 'unfiled', name: 'No folder', group: 'No folder' };
  let root = gitRoot || cwd;
  const wt = root.indexOf('/.claude/worktrees/');
  if (wt >= 0) root = root.slice(0, wt);
  const name = basename(root);
  const m = root.match(/\/source_code\/([^/]+)\//);
  const group = m ? GROUPS[m[1].toLowerCase()] ?? m[1][0].toUpperCase() + m[1].slice(1) : 'Other';
  return { key: name, name, group, root };
}

export function defaultLook(key: string, usedHues: Set<string> = new Set(), usedIcons: Set<string> = new Set()): { icon: string; hue: string } {
  if (key === 'unfiled') return { icon: 'inbox', hue: 'slate' };
  const lower = key.toLowerCase();
  const pick = (list: string[], used: Set<string>, seed: string) => {
    const start = hashIndex(seed, list.length);
    for (let i = 0; i < list.length; i++) {
      const v = list[(start + i) % list.length];
      if (!used.has(v)) return v;
    }
    return list[start];
  };
  const icon = KEYWORD_ICONS.find(([re, ic]) => re.test(lower) && !usedIcons.has(ic))?.[1] ?? pick(ICONS, usedIcons, lower);
  // Each project gets its own color while colors last, so two projects never look alike.
  return { icon, hue: pick(HUES.filter((h) => h !== 'slate'), usedHues, lower + '#') };
}
