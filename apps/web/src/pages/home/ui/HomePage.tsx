import { useMemo, type ReactNode } from 'react';
import type { Item, State } from '@/shared/api';
import { useNow } from '@/shared/lib';
import { groupByProject } from '../model/group';
import { ConversationCard } from './ConversationCard';
import { useSearch } from '../model/use-search';
import { SearchBox } from './SearchBox';
import { SearchResults } from './SearchResults';
import { ArchiveButton, RestoreButton } from './ArchiveButton';
import { ResumeButton } from './ResumeButton';
import { ProjectNav } from './ProjectNav';
import { ProjectSection } from './ProjectSection';

/** Text that reads like a message or a link (not a few keywords) is worth copying into the chat you open. */
const looksLikeMessage = (q: string) => q.trim().length >= 40 || q.includes('\n') || /https?:\/\//.test(q);

/** All chats as cards grouped by project, with one box on top to find the chat a message belongs to. */
export function HomePage({ data }: { data: State }) {
  const now = useNow();
  const search = useSearch();
  const byId = useMemo(() => new Map(data.items.map((c) => [c.id, c])), [data.items]);
  const projects = useMemo(() => new Map(data.projects.map((p) => [p.key, p])), [data.projects]);
  const groups = useMemo(() => groupByProject(data.items, data.projects, now), [data.items, data.projects, now]);
  const searching = !!search.q.trim();
  const copyText = searching && looksLikeMessage(search.q) ? search.q : undefined;

  const card = (c: Item, banner?: ReactNode) => (
    <ConversationCard
      c={c}
      project={banner ? projects.get(c.project) : undefined}
      banner={banner}
      actions={
        <>
          {!c.archived ? <ArchiveButton c={c} /> : c.archivedBy === 'board' && <RestoreButton c={c} />}
          <ResumeButton c={c} copyText={banner ? copyText : undefined} />
        </>
      }
    />
  );

  return (
    <>
      <div className="bar">
        <div className="bar-in">
          <SearchBox q={search.q} onChange={search.setQ} onAsk={search.ask} onClear={search.clear} busy={search.ai.status === 'loading'} />
          {!searching && <ProjectNav groups={groups} />}
        </div>
      </div>
      <main className="content">
        {searching ? (
          <SearchResults q={search.q} quick={search.quick} ai={search.ai} onAsk={() => search.ask()} byId={byId} total={data.items.filter((c) => !c.archived).length} render={card} />
        ) : groups.length ? (
          groups.map((g) => <ProjectSection key={g.project.key} g={g} render={(c) => card(c)} />)
        ) : (
          <div className="empty">
            <b>No chats yet</b>
            <p>Chats from the Claude app and Claude Code show up here as soon as they start.</p>
          </div>
        )}
      </main>
    </>
  );
}
