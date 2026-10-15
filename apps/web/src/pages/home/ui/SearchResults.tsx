import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import type { Item, SearchHit } from '@/shared/api';
import { ease, Icon } from '@/shared/ui';
import type { AiState } from '../model/use-search';

const CONF = { high: 'Strong match', med: 'Likely', low: 'Possible' } as const;

/** Why a chat matched, shown on top of its card. */
function MatchNote({ hit }: { hit: SearchHit }) {
  return (
    <div className={`match v-${hit.via}${hit.confidence ? ` c-${hit.confidence}` : ''}`}>
      <Icon name={hit.via === 'link' ? 'link' : hit.via === 'ai' ? 'sparkle' : 'search'} size={13} />
      <span>{hit.why}</span>
      {hit.via === 'ai' && hit.confidence && <em>{CONF[hit.confidence]}</em>}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.round((Date.now() - since) / 1000))}s</>;
}

function Grid({ hits, byId, render }: { hits: SearchHit[]; byId: Map<string, Item>; render: (c: Item, banner: ReactNode) => ReactNode }) {
  return (
    <div className="grid">
      <AnimatePresence initial={false}>
        {hits.map((h) => {
          const c = byId.get(h.id);
          return c ? (
            <motion.div key={h.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={ease}>
              {render(c, <MatchNote hit={h} />)}
            </motion.div>
          ) : null;
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * Results for the search box, most certain first: chats that share a pasted link, then Claude's pick,
 * then chats that share words. Each chat appears once.
 */
export function SearchResults({ q, quick, ai, onAsk, byId, total, render }: { q: string; quick: SearchHit[]; ai: AiState; onAsk: () => void; byId: Map<string, Item>; total: number; render: (c: Item, banner: ReactNode) => ReactNode }) {
  const exact = quick.filter((h) => h.via === 'link' && byId.has(h.id));
  const seen = new Set(exact.map((h) => h.id));
  const picks = ai.status === 'done' ? ai.hits.filter((h) => !seen.has(h.id) && byId.has(h.id)) : [];
  picks.forEach((h) => seen.add(h.id));
  // A pasted link with an exact match needs nothing else; word matches only help when there's text to match.
  const prose = q.replace(/https?:\/\/\S+/g, '').trim().length >= 20;
  const words = exact.length && !prose ? [] : quick.filter((h) => h.via === 'words' && !seen.has(h.id) && byId.has(h.id)).slice(0, 6);

  return (
    <div className="results">
      {exact.length > 0 && (
        <section className="res-sec">
          <h2>
            <Icon name="link" size={15} /> Same link
          </h2>
          <Grid hits={exact} byId={byId} render={render} />
        </section>
      )}

      <section className="res-sec">
        <h2>
          <Icon name="sparkle" size={15} /> Claude’s pick
        </h2>
        {ai.status === 'idle' && (
          <button className="res-ask" onClick={onAsk}>
            Press <kbd>↵</kbd> and Claude reads your {total} chats, archived ones included, to find where this belongs.
          </button>
        )}
        {ai.status === 'loading' && (
          <div className="res-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Claude is reading your chats… <Elapsed since={ai.startedAt} />
            <div className="grid">
              <div className="card skel" />
              <div className="card skel" />
            </div>
          </div>
        )}
        {ai.status === 'error' && (
          <p className="res-note err">
            {ai.error}{' '}
            <button className="linkbtn" onClick={onAsk}>
              Try again
            </button>
          </p>
        )}
        {ai.status === 'done' &&
          (picks.length ? (
            <Grid hits={picks} byId={byId} render={render} />
          ) : (
            <p className="res-note">
              {ai.hits.length ? 'Claude picked the same chats as above.' : 'Claude didn’t find a chat this belongs to. It may be new work: start a chat from its project.'}
            </p>
          ))}
      </section>

      {words.length > 0 && (
        <section className="res-sec">
          <h2>
            <Icon name="search" size={15} /> Also mentions these words
          </h2>
          <Grid hits={words} byId={byId} render={render} />
        </section>
      )}
    </div>
  );
}
