import type { Item } from '@/shared/api';

export type Tone = 'run' | 'you' | 'wait' | 'prog' | 'done';

const WAIT: Record<string, string> = { be: 'backend', design: 'design', client: 'client', qa: 'QA', rev: 'review' };

/** One word-or-two status, coloured by who has the next move. */
export function statusOf(c: Item): { tone: Tone; label: string } {
  if (c.archived) return { tone: 'done', label: c.archivedBy === 'claude' ? 'Archived in Claude' : c.archivedBy === 'age' ? 'Older terminal chat' : 'Archived' };
  if (c.live === 'running') return { tone: 'run', label: 'Claude is working' };
  if (c.live === 'input') return { tone: 'you', label: 'Needs your approval' };
  switch (c.reading.o) {
    case 'decision':
      return { tone: 'you', label: 'Needs you' };
    case 'waiting':
      return { tone: 'wait', label: `Waiting on ${c.reading.who || WAIT[c.reading.on ?? ''] || 'others'}` };
    case 'progress':
      return { tone: 'prog', label: 'In progress' };
    default:
      return { tone: 'done', label: 'Done' };
  }
}

/** Claude's short topic title when it exists, otherwise the chat's own title. */
export const titleOf = (c: Item) => c.aiTitle || c.title;

/** Only chats Claude Code knows a session for can be opened. */
export const canResume = (c: Item) => !!c.cliSessionId || c.id.startsWith('local_');
