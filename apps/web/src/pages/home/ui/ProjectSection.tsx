import { LayoutGroup, motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import type { Item } from '@/shared/api';
import { spring, Tile } from '@/shared/ui';
import type { ProjectGroup } from '../model/group';
import { NewChatButton } from './NewChatButton';

export const sectionId = (key: string) => `p-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;

/** A project's chats as cards, newest first. Finished and long-idle chats wait behind "Show older". */
export function ProjectSection({ g, render }: { g: ProjectGroup; render: (c: Item) => ReactNode }) {
  const [showOlder, setShowOlder] = useState(false);
  const list = showOlder ? [...g.recent, ...g.older] : g.recent;
  const total = g.recent.length + g.older.length;
  const p = g.project;
  return (
    <section className={`proj hue-${p.hue}`} id={sectionId(p.key)} aria-labelledby={`${sectionId(p.key)}-h`}>
      <header className="proj-h">
        <Tile project={p} />
        <h2 id={`${sectionId(p.key)}-h`}>{p.name}</h2>
        {p.group && p.group !== p.name && <span className="proj-org">{p.group}</span>}
        <span className="proj-n">
          {total} chat{total === 1 ? '' : 's'}
        </span>
        <span className="sp" />
        <NewChatButton project={p} />
      </header>
      {list.length > 0 && (
        <LayoutGroup id={p.key}>
          <div className="grid">
            {list.map((c) => (
              <motion.div key={c.id} layout="position" transition={spring} initial={false}>
                {render(c)}
              </motion.div>
            ))}
          </div>
        </LayoutGroup>
      )}
      {g.older.length > 0 && (
        <button className="linkbtn proj-more" onClick={() => setShowOlder((v) => !v)} aria-expanded={showOlder}>
          {showOlder ? 'Hide older chats' : `Show ${g.older.length} older chat${g.older.length === 1 ? '' : 's'}`}
        </button>
      )}
    </section>
  );
}
