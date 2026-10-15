import { memo, type ReactNode } from 'react';
import type { Item, Project } from '@/shared/api';
import { ago, fullDate, useNow } from '@/shared/lib';
import { Icon, Tile } from '@/shared/ui';
import { statusOf, titleOf } from '../model/status';
import { LinkChips } from './LinkChips';
import { Thumbs } from './Thumbs';

/**
 * One chat at a glance: pictures, what it's about, where it stands, its links, and when it last moved.
 * `banner` (why it matched a search) and `actions` (Resume, Archive) are filled in by the page.
 */
export const ConversationCard = memo(function ConversationCard({ c, project, banner, actions }: { c: Item; project?: Project; banner?: ReactNode; actions?: ReactNode }) {
  const now = useNow();
  const st = statusOf(c);
  const title = titleOf(c);
  const next = st.tone === 'run' ? (c.now ? `Now: ${c.now}` : undefined) : c.summary || c.reading.next;
  return (
    <article className={`card t-${st.tone}${st.tone === 'run' ? ' working' : ''}`} data-id={c.id} aria-label={title}>
      {banner}
      <Thumbs c={c} />
      <div className="card-body">
        <div className="card-meta">
          <span className={`st t-${st.tone}`}>
            <i aria-hidden="true" />
            {st.label}
          </span>
          {project && (
            <span className="card-proj">
              <Tile project={project} size="sm" />
              {project.name}
            </span>
          )}
          <time dateTime={new Date(c.updatedAt).toISOString()} title={`Last message: ${fullDate(c.updatedAt)}`}>
            {ago(c.updatedAt, now)}
          </time>
        </div>
        <h3 className="card-title" title={title !== c.title ? `In Claude: ${c.title}` : undefined}>
          {title}
        </h3>
        {c.about ? <p className="card-about">{c.about}</p> : c.task ? <p className="card-about is-ask">“{c.task}”</p> : null}
        {next && (
          <p className="card-next">
            <Icon name="arrow" size={13} />
            <span>{next}</span>
          </p>
        )}
        <LinkChips links={c.links} />
      </div>
      <footer className="card-foot">
        {c.branch ? (
          <span className="branch" title={`Branch ${c.branch}`}>
            <Icon name="branch" size={12} />
            <span>{c.branch}</span>
          </span>
        ) : (
          <span />
        )}
        <div className="card-acts">{actions}</div>
      </footer>
    </article>
  );
});
