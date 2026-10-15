import { api, type Project } from '@/shared/api';
import { Icon, toast } from '@/shared/ui';

/** Starts a new Claude Code session in the project's folder. */
export function NewChatButton({ project }: { project: Project }) {
  return (
    <button
      className="btn ghost sm"
      aria-label={`New chat in ${project.name}`}
      title={project.key === 'unfiled' ? 'New Claude Code chat' : `New Claude Code chat in ${project.name}`}
      onClick={() =>
        api.newSession(project.key).then(
          () => toast(project.key === 'unfiled' ? 'Opening a new chat in Claude' : `Opening a new chat in ${project.name}`),
          (e) => toast(e.message ?? 'Could not open Claude'),
        )
      }
    >
      <Icon name="plus" size={14} />
      <span className="btn-t">New chat</span>
    </button>
  );
}
