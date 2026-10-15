import type { ProjectGroup } from '../model/group';
import { Tile } from '@/shared/ui';
import { sectionId } from './ProjectSection';

/** Jump to a project. Running chats get a moving ring on their project's tile. */
export function ProjectNav({ groups }: { groups: ProjectGroup[] }) {
  if (groups.length < 2) return null;
  return (
    <nav className="pnav" aria-label="Projects">
      {groups.map((g) => {
        const working = [...g.recent, ...g.older].filter((c) => c.live === 'running').length;
        return (
          <a
            key={g.project.key}
            href={`#${sectionId(g.project.key)}`}
            className="pnav-i"
            title={working ? `Claude is working in ${g.project.name}` : g.project.name}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(sectionId(g.project.key))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            <span className={`pnav-tile${working ? ' working' : ''}`}>
              <Tile project={g.project} size="sm" />
            </span>
            {g.project.name}
            <span className="n">{g.recent.length + g.older.length}</span>
          </a>
        );
      })}
    </nav>
  );
}
