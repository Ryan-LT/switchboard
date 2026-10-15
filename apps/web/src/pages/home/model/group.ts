import type { Item, Project } from '@/shared/api';

const DAY = 86400000;

export interface ProjectGroup {
  project: Project;
  /** Shown straight away: anything open, and anything that moved in the last few days. */
  recent: Item[];
  /** Behind "Show older": finished more than 3 days ago, or untouched for two weeks. */
  older: Item[];
  latest: number;
}

const isOlder = (c: Item, now: number) => c.live !== 'running' && ((c.reading.o === 'done' && now - c.updatedAt > 3 * DAY) || now - c.updatedAt > 14 * DAY);

/** Projects with the most recent activity first; chats newest first inside each. */
export function groupByProject(items: Item[], projects: Project[], now: number): ProjectGroup[] {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const groups = new Map<string, Item[]>();
  for (const c of items) {
    if (c.archived) continue;
    const list = groups.get(c.project);
    if (list) list.push(c);
    else groups.set(c.project, [c]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
      const project = byKey.get(key) ?? { key, name: key, group: 'Other', icon: 'grid', hue: 'slate' };
      return { project, recent: sorted.filter((c) => !isOlder(c, now)), older: sorted.filter((c) => isOlder(c, now)), latest: sorted[0]?.updatedAt ?? 0 };
    })
    .sort((a, b) => Number(!a.recent.length) - Number(!b.recent.length) || b.latest - a.latest);
}
