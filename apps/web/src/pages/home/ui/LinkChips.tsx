import { useState } from 'react';
import type { Link, LinkKind } from '@/shared/api';
import { Icon, type IconName } from '@/shared/ui';

const ICON: Record<LinkKind, IconName> = { issue: 'issue', pr: 'pr', figma: 'figma', slack: 'slack', jira: 'issue', linear: 'issue', trello: 'doc', notion: 'doc' };

const FIRST = 4;

/** Issues, PRs and design/thread links; each opens in a new tab. The full title shows on hover. */
export function LinkChips({ links }: { links: Link[] }) {
  const [all, setAll] = useState(false);
  if (!links.length) return null;
  const shown = all || links.length <= FIRST + 1 ? links : links.slice(0, FIRST);
  return (
    <div className="chips">
      {shown.map((l) => (
        <a
          key={l.url}
          className={`chip k-${l.kind}${l.state ? ` s-${l.state}` : ''}`}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          title={l.title ? `${l.label}: ${l.title}${l.state ? ` (${l.state})` : ''}` : l.label}
        >
          <Icon name={l.kind === 'pr' && l.state === 'merged' ? 'merged' : ICON[l.kind]} size={13} />
          <span>{l.label}</span>
          {l.state && l.state !== 'open' && <em>{l.state}</em>}
          <Icon name="external" size={11} className="ext" />
        </a>
      ))}
      {shown.length < links.length && (
        <button className="chip more" onClick={() => setAll(true)} title={links.slice(FIRST).map((l) => l.label).join(', ')}>
          +{links.length - FIRST} more
        </button>
      )}
    </div>
  );
}
