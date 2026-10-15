/** Calls to the local Claude Board agent. */
import type { SearchHit, State } from './transport';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

const post = (url: string, body?: unknown, signal?: AbortSignal) =>
  fetch(url, { method: 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });

export interface AiSearchResult {
  hits: SearchHit[];
  ms: number;
  tokens: number;
  considered: number;
}

export const api = {
  state: () => fetch('/api/state').then((r) => json<State>(r)),
  archive: (ids: string[]) => post('/api/archive', { ids }).then((r) => json(r)),
  unarchive: (ids: string[]) => post('/api/unarchive', { ids }).then((r) => json(r)),
  newSession: (key: string) => post(`/api/projects/${encodeURIComponent(key)}/new`).then((r) => json<{ ok: boolean; url: string }>(r)),
  /** `dry` reports where it would open (and whether Claude would have to import it) without opening anything. */
  openInClaude: (id: string, dry = false) => post(`/api/items/${encodeURIComponent(id)}/open${dry ? '?dry=1' : ''}`).then((r) => json<{ ok: boolean; url: string; imported: boolean }>(r)),
  /** Instant: shared links, then words. */
  search: (q: string, signal?: AbortSignal) => post('/api/search', { q }, signal).then((r) => json<{ hits: SearchHit[] }>(r)),
  /** Claude reads every chat's card and picks the ones this message belongs to. */
  searchAi: (q: string, signal?: AbortSignal) => post('/api/search/ai', { q }, signal).then((r) => json<AiSearchResult>(r)),
  imageUrl: (id: string, full = false) => `/api/img/${id}${full ? '?full=1' : ''}`,
};
