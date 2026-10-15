import type { Project } from '@/shared/api';
import { ProjectGlyph } from './icon';

/** A project's icon on its colour. */
export function Tile({ project, size = '' }: { project?: Project; size?: '' | 'sm' | 'lg' }) {
  if (!project) return <span className={`ptile ${size} hue-slate`} />;
  return (
    <span className={`ptile ${size} hue-${project.hue}`} title={project.name}>
      <ProjectGlyph icon={project.icon} />
    </span>
  );
}
