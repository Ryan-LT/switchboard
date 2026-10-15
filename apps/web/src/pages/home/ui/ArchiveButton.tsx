import { api, type Item } from '@/shared/api';
import { Icon, toast } from '@/shared/ui';
import { canResume } from '../model/status';

/**
 * Hides the chat here, then opens it in Claude so you can archive it there too (Claude has no way for other apps
 * to archive a session). Chats from another Claude account are only hidden here; opening them would import a copy.
 */
export function ArchiveButton({ c }: { c: Item }) {
  const onClick = async () => {
    try {
      await api.archive([c.id]);
    } catch (e: any) {
      return toast(e.message ?? 'Could not archive');
    }
    const undo = { label: 'Undo', run: () => void api.unarchive([c.id]) };
    if (!canResume(c)) return toast('Archived', undo);
    try {
      const target = await api.openInClaude(c.id, true);
      if (target.imported) return toast('Archived here. It belongs to your other Claude account, so archive it there when you switch.', undo);
      await api.openInClaude(c.id);
      toast('Archived here and opened in Claude: right-click it in the sidebar and choose Archive to finish.', undo);
    } catch {
      toast('Archived', undo);
    }
  };
  return (
    <button className="btn ghost icon sm" onClick={onClick} aria-label="Archive" title="Archive">
      <Icon name="archive" size={15} />
    </button>
  );
}

/** Brings a chat you archived here back onto the board (chats archived in the Claude app stay archived there). */
export function RestoreButton({ c }: { c: Item }) {
  return (
    <button
      className="btn ghost sm"
      title="Put it back on the board"
      onClick={() => api.unarchive([c.id]).then(() => toast('Back on the board'), (e) => toast(e.message ?? 'Could not restore'))}
    >
      <Icon name="archive" size={14} />
      Restore
    </button>
  );
}
