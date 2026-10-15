// Shared between the agent and the web app (the web app imports these as types only).

export type Outcome = 'decision' | 'waiting' | 'progress' | 'done';
export type WaitingOn = 'be' | 'design' | 'client' | 'qa' | 'rev';
export type Confidence = 'high' | 'med' | 'low';
/** Where a reading came from. `app` = the Claude desktop app's own post-turn summary (0 extra tokens). */
export type ReadingSource = 'app' | 'rules' | 'you';
export type LiveState = 'running' | 'input' | 'idle' | 'ended';

export interface Reading {
  o: Outcome;
  kind: string;
  next: string;
  conf: Confidence;
  by: ReadingSource;
  /** The sentence the reading is based on. */
  evidence?: string;
  evidenceFrom?: string;
  on?: WaitingOn;
  who?: string;
  /** Epoch ms. */
  followUpAt?: number;
}

export interface PullRequest {
  n: number;
  repo: string;
  url: string;
  state: 'open' | 'merged' | 'closed' | 'draft';
  title?: string;
  checks?: 'pass' | 'fail' | 'pending' | null;
  review?: 'approved' | 'changes' | 'requested' | 'commented' | null;
  comments?: number;
}

export type LinkKind = 'issue' | 'pr' | 'figma' | 'slack' | 'jira' | 'linear' | 'trello' | 'notion';

/** An issue, PR or design/thread link that belongs to the conversation. */
export interface Link {
  kind: LinkKind;
  url: string;
  /** Short label: "Issue #232", "PR #302", "Figma · Checkout", "Slack thread". */
  label: string;
  /** The issue or PR title from GitHub, when known. */
  title?: string;
  state?: 'open' | 'closed' | 'merged' | 'draft';
}

/** A picture that shows what the task is: one you pasted into the chat, or one from the linked issue or PR. */
export interface ImageRef {
  id: string;
  from: 'chat' | 'issue' | 'pr';
  /** The message you sent with it, or the image's alt text. */
  caption?: string;
  at?: number;
}

export interface SearchHit {
  id: string;
  /** Why this chat matches, in a few words. */
  why: string;
  via: 'link' | 'words' | 'ai';
  confidence?: 'high' | 'med' | 'low';
  score: number;
}

export interface Item {
  id: string;
  cliSessionId?: string;
  title: string;
  project: string;
  cwd: string;
  branch?: string;
  account: string;
  archivedInApp: boolean;
  live: LiveState;
  /** Epoch ms of the last activity. */
  updatedAt: number;
  startedAt: number;
  last?: { who: string; text: string; at: number };
  lastPrompt?: string;
  reading: Reading;
  /** The automatic reading, kept so the UI can offer "use the automatic reading" after a manual override. */
  auto: Reading;
  appSummary?: { status?: string; detail?: string; needs?: string };
  prs: PullRequest[];
  msgs: number;
  model?: string;
  cost?: number;
  linesAdded?: number;
  linesRemoved?: number;
  /** Messages per day for the last 7 days, oldest first. */
  act7: number[];
  /** Last tool action, e.g. "Bash: pnpm test". */
  now?: string;
  todos: Array<[string, boolean]>;
  tests?: { passed: number; total: number };
  notes: Note[];
  /** AI-written status of where the conversation stands. */
  summary?: string;
  /** AI-written topic title, e.g. "Invite users without email (#232)". */
  aiTitle?: string;
  /** AI-written description of what the task is. */
  about?: string;
  /** Your first message, the original ask. Used as the description until the AI one exists. */
  task?: string;
  links: Link[];
  images: ImageRef[];
  snoozeUntil?: number;
  /** Hidden from the board, still searchable. */
  archived: boolean;
  /** Why it's hidden: you archived it here, it's archived in the Claude app, or it's a terminal chat idle for days. */
  archivedBy?: 'board' | 'claude' | 'age';
  transcriptPath?: string;
}

/** A note you leave on a conversation so it's quick to pick back up. */
export interface Note {
  id: string;
  text: string;
  at: number;
  editedAt?: number;
}

export interface Project {
  key: string;
  name: string;
  group: string;
  icon: string;
  hue: string;
  root?: string;
}

export interface FeedEvent {
  id: number;
  itemId: string;
  at: number;
  text: string;
  outcome?: Outcome | null;
  src: 'app' | 'rules' | 'github' | 'you' | 'hook' | 'transcript';
  tokens: number;
}

export interface Meter {
  readings: number;
  byApp: number;
  byRules: number;
  byAi: number;
  tokens: number;
  cap: number;
}

export interface State {
  now: number;
  items: Item[];
  projects: Project[];
  feed: FeedEvent[];
  meter: Meter;
  sources: { desktopSessions: number; transcripts: number; liveSessions: number; github: boolean; hooks: boolean };
}

export interface ItemPatch {
  outcome?: Outcome;
  kind?: string;
  on?: WaitingOn;
  who?: string;
  followUpAt?: number | null;
  next?: string;
  resetOutcome?: boolean;
  /** The full list, newest first; the page sends it whole after an add, edit or delete. */
  notes?: Note[];
  snoozeUntil?: number | null;
  archived?: boolean;
  project?: string;
}
