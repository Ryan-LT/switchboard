import type { BoardAi, BoardCard, BoardHit } from '../types'

const DAY = 86400000
const WAIT: Record<string, string> = { be: 'backend', design: 'design', client: 'client', qa: 'QA', rev: 'review' }

/** The agent's chat, the fields the pane uses (the agent owns the full shape). */
type AgentItem = {
  id: string
  title: string
  project: string
  cliSessionId?: string
  live: string
  updatedAt: number
  archived: boolean
  archivedBy?: 'board' | 'claude' | 'age'
  aiTitle?: string
  about?: string
  task?: string
  summary?: string
  reading: { o: string; next?: string; on?: string; who?: string }
  links?: Array<{ label: string; url: string; state?: string; title?: string }>
  images?: Array<{ id: string }>
}

type AgentState = { items?: AgentItem[]; projects?: Array<{ key: string; name: string }> }

function status(c: AgentItem): Pick<BoardCard, 'tone' | 'label'> {
  if (c.archived) return { tone: 'done', label: c.archivedBy === 'claude' ? 'Archived in Claude' : c.archivedBy === 'age' ? 'Older terminal chat' : 'Archived' }
  if (c.live === 'running') return { tone: 'run', label: 'Claude is working' }
  if (c.live === 'input') return { tone: 'you', label: 'Needs your approval' }
  if (c.reading.o === 'decision') return { tone: 'you', label: 'Needs you' }
  if (c.reading.o === 'waiting') return { tone: 'wait', label: `Waiting on ${c.reading.who || WAIT[c.reading.on ?? ''] || 'others'}` }
  if (c.reading.o === 'progress') return { tone: 'prog', label: 'In progress' }
  return { tone: 'done', label: 'Done' }
}

/** One card per chat, newest first. */
export function toCards(s: AgentState, now: number): BoardCard[] {
  const names = new Map((s.projects ?? []).map((p) => [p.key, p.name]))
  return (s.items ?? [])
    .map((c): BoardCard => {
      const st = status(c)
      return {
        id: c.id,
        project: c.project,
        projectName: names.get(c.project) ?? c.project,
        title: c.aiTitle || c.title,
        about: c.about || c.task,
        next: st.tone === 'run' ? undefined : c.summary || c.reading.next,
        ...st,
        at: c.updatedAt,
        links: (c.links ?? []).map((l) => ({ label: l.label, url: l.url, state: l.state, title: l.title })),
        image: c.images?.[0]?.id,
        canResume: !!c.cliSessionId || c.id.startsWith('local_'),
        archived: c.archived,
        older: c.live !== 'running' && ((c.reading.o === 'done' && now - c.updatedAt > 3 * DAY) || now - c.updatedAt > 14 * DAY),
      }
    })
    .sort((a, b) => b.at - a.at)
}

/** "just now", "5m ago", "1h ago", "3d ago", "2w ago". */
export function ago(at: number, now: number): string {
  const m = Math.floor(Math.max(0, now - at) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 14 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`
}

/**
 * Search results, most certain first and each chat once: chats sharing a pasted link, Claude's pick,
 * then word matches (left out when a pasted link already matched and there is no other text).
 */
export function sections(q: string, quick: BoardHit[], ai: BoardAi, known: (id: string) => boolean) {
  const exact = quick.filter((h) => h.via === 'link' && known(h.id))
  const seen = new Set(exact.map((h) => h.id))
  const picks = ai.status === 'done' ? ai.hits.filter((h) => !seen.has(h.id) && known(h.id)) : []
  picks.forEach((h) => seen.add(h.id))
  const prose = q.replace(/https?:\/\/\S+/g, '').trim().length >= 20
  const words = exact.length && !prose ? [] : quick.filter((h) => h.via === 'words' && !seen.has(h.id) && known(h.id)).slice(0, 5)
  return { exact, picks, words }
}

/** Text that reads like a message or a link, not a few keywords: worth copying into the chat you open. */
export const looksLikeMessage = (q: string) => q.trim().length >= 40 || q.includes('\n') || /https?:\/\//.test(q)

/** The size a card's picture is drawn at, in CSS pixels; the JPEG behind it is twice that, so it stays sharp. */
export const THUMB = { w: 168, h: 96 } as const

/** A picture as an SVG the desktop draws as an image: a small tile cropped from the top. */
export const thumbSvg = (dataUri: string, w: number = THUMB.w, h: number = THUMB.h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${dataUri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMin slice"/></svg>`

/** The picture beside each /find line: small, so the answer stays short. */
export const FIND_THUMB = { w: 96, h: 56 } as const
