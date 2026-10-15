import { useEffect, useRef, useState } from 'react';
import { api } from './client';
import type { Item, State } from './transport';

export type Conn = 'connecting' | 'live' | 'offline';

/**
 * Loads state once, then refetches only when the agent says something changed (Server-Sent Events).
 * Nothing polls, and refetches are coalesced so a burst of changes costs one request.
 */
export function useLiveState() {
  const [data, setData] = useState<State | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  // Reuse unchanged conversation objects across refreshes so memoized rows don't re-render.
  const known = useRef(new Map<string, { json: string; item: Item }>());

  const refresh = () => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = api
      .state()
      .then((s) => {
        const next = new Map<string, { json: string; item: Item }>();
        s.items = s.items.map((item) => {
          const json = JSON.stringify(item);
          const prev = known.current.get(item.id);
          const entry = prev && prev.json === json ? prev : { json, item };
          next.set(item.id, entry);
          return entry.item;
        });
        known.current = next;
        setData(s);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        inflight.current = null;
        if (again.current) {
          again.current = false;
          void refresh();
        }
      });
    return inflight.current;
  };

  useEffect(() => {
    void refresh();
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('change', () => {
        setConn('live');
        void refresh();
      });
      es.onerror = () => {
        setConn('offline');
        es?.close();
        retry = setTimeout(open, 3000);
      };
    };
    open();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      es?.close();
      clearTimeout(retry);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return { data, conn, error, refresh };
}
