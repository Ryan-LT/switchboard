import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SearchHit } from '@/shared/api';

export type AiState =
  | { status: 'idle' }
  | { status: 'loading'; q: string; startedAt: number }
  | { status: 'done'; q: string; hits: SearchHit[]; ms: number; considered: number }
  | { status: 'error'; q: string; error: string };

/**
 * Two searches over the same text: quick matches (links and words, instant, free) follow your typing;
 * Claude's pick runs when you press Enter or paste, and belongs to the text it was asked about.
 */
export function useSearch() {
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState<SearchHit[]>([]);
  const [ai, setAi] = useState<AiState>({ status: 'idle' });
  const aiCtl = useRef<AbortController | null>(null);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setQuick([]);
      return;
    }
    const ctl = new AbortController();
    // Keeps the previous matches on screen until the new ones arrive, so the list doesn't flash empty.
    const t = setTimeout(() => api.search(text, ctl.signal).then((r) => setQuick(r.hits), () => {}), 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  // Editing the text sets Claude's pick aside; it answered a different question.
  useEffect(() => {
    setAi((a) => {
      if (a.status === 'idle' || a.q === q.trim()) return a;
      aiCtl.current?.abort();
      return { status: 'idle' };
    });
  }, [q]);

  const ask = useCallback(
    (text?: string) => {
      const t = (text ?? q).trim();
      if (!t) return;
      aiCtl.current?.abort();
      const ctl = new AbortController();
      aiCtl.current = ctl;
      setAi({ status: 'loading', q: t, startedAt: Date.now() });
      api.searchAi(t, ctl.signal).then(
        (r) => !ctl.signal.aborted && setAi({ status: 'done', q: t, hits: r.hits, ms: r.ms, considered: r.considered }),
        (e) => !ctl.signal.aborted && setAi({ status: 'error', q: t, error: e.message ?? 'Claude search failed' }),
      );
    },
    [q],
  );

  const clear = useCallback(() => {
    aiCtl.current?.abort();
    setQ('');
    setAi({ status: 'idle' });
  }, []);

  return { q, setQ, quick, ai, ask, clear };
}
