/** One chat, as the pane draws it. */
export type BoardCard = {
  id: string
  project: string
  projectName: string
  title: string
  about?: string
  /** What happens next, or where it stands. */
  next?: string
  tone: 'run' | 'you' | 'wait' | 'prog' | 'done'
  label: string
  /** Epoch ms of the last message. */
  at: number
  links: Array<{ label: string; url: string; state?: string; title?: string }>
  /** The first picture's id at the agent, if the chat has one. */
  image?: string
  canResume: boolean
  archived: boolean
  /** Finished a while ago, or idle for two weeks: behind "Show older". */
  older: boolean
}

/** Why a chat matched a search. */
export type BoardHit = { id: string; why: string; via: 'link' | 'words' | 'ai'; confidence?: 'high' | 'med' | 'low' }

export type BoardAi =
  | { status: 'idle' }
  | { status: 'loading'; q: string; at: number }
  | { status: 'done'; q: string; hits: BoardHit[] }
  | { status: 'error'; q: string; error: string }

/** One /find answer, kept by the text it was asked about so its row can draw the cards. */
export type BoardFind = { status: 'loading' | 'done' | 'error'; hits: BoardHit[]; error?: string }

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      cards: BoardCard[]
      /** Picture id to a small JPEG data URI. */
      thumbs: Record<string, string>
      /** /find answers by query. */
      finds: Record<string, BoardFind>
    }
  }
}
