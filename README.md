# Switchboard

A local command center for every Claude conversation you have open: what each one is, what's going on in it, and what has ended.

Switchboard reads the files Claude already writes on your Mac and gives every conversation one of four outcomes:

| Outcome | Means |
| --- | --- |
| **Needs your decision** | Claude asked a question, wants approval, or finished work for you to review |
| **Waiting on others** | Backend, a designer, the client, QA or a reviewer has to act first |
| **In progress** | Claude is working, or has a next step it will do without you |
| **Done** | Merged, closed, confirmed, or answered with nothing left open |

Everything is grouped by project, each with its own icon and color, and every row shows the next step, the last message, PR and test status, changes, cost and age.

## Run it

Needs macOS, Node 22.12+ and pnpm.

```bash
git clone https://github.com/Ryan-LT/switchboard.git && cd switchboard
pnpm install
pnpm start          # builds the UI and serves everything at http://127.0.0.1:4317
```

For development (hot reload for both halves):

```bash
pnpm dev            # agent on :4317, UI on http://127.0.0.1:5173
```

Optional:

```bash
pnpm hooks:install      # Claude Code hooks for instant updates (backs up ~/.claude/settings.json first)
pnpm autostart:install  # start Switchboard at login (launchd)
```

## `/find` in Claude Code

Paste a teammate's reply, an issue/PR link or a task description, and `/find` answers in the conversation with the chat it belongs to and a button to continue it.

Run this in a terminal `claude` session:

```
/plugin install switchboard --marketplace Ryan-LT/switchboard
```

Answer `y` to add the marketplace, then choose the **user** scope. Then:

```
/find BE replied on #232, the invite endpoint is ready
```

`/find` asks the Switchboard agent above. If it isn't running, `/find` starts it from `~/Desktop/source_code/personal/switchboard`; cloned somewhere else, either keep it running (`pnpm start`, or `pnpm autostart:install`) or set `SWITCHBOARD_DIR` to your clone.

## Where the data comes from

All reading happens on your Mac. Nothing is sent anywhere, and **no AI tokens are used**.

| Source | Gives |
| --- | --- |
| `~/Library/Application Support/Claude/claude-code-sessions` | The Claude app's session list: titles, folders, archived state, PRs, and the app's own post-turn summary ("blocked: needs X") |
| `~/.claude/sessions/*.json` | Which sessions are running right now |
| `~/.claude/projects/**/<session>.jsonl` | Last messages, last prompt, branch, model, cost, lines changed, tests, Claude's plan. Read incrementally: only new bytes |
| `gh pr view` | PR title, state, checks and review status (cached 10 minutes per PR) |
| Claude Code hooks (optional) | Instant "waiting for approval" and "running" signals |

Your own changes (outcome corrections, who you're waiting on, follow-up dates, notes, snoozes, archive, project icons) are stored in `~/Library/Application Support/Switchboard/switchboard.db`. Switchboard never writes to Claude's files.

## How a reading is made

`apps/agent/src/reader.ts`, in order:

1. Live state: running, or a permission prompt from a hook.
2. Claude stopped with an error.
3. You spoke last: "thanks"/"looks good" means done; "sent to the client" means waiting.
4. The Claude app's own summary says it's blocked and what it needs.
5. Claude's last message ends with a real question, ignoring polite closings like "Anything else?", or asks you to check something.
6. PR state: changes requested, review comments, approved, open, or merged/closed.
7. Claude's message says it's blocked on someone.
8. The app summary says the turn completed and nothing is needed.
9. Completion words, then "idle over a week" (low confidence, so you confirm).

A manual correction holds until a new message arrives, then the automatic reading takes over again.

## Layout

```
apps/agent   Node + Hono service on 127.0.0.1:4317: file watchers, reader, SQLite, SSE
apps/web     React + Vite UI: Projects, Needs me, Board, Activity, Done
```

## Keyboard

`j`/`k` move · `Enter` open · `e` done · `w` waiting · `r` copy resume command · `/` search · `⌘K` commands · `1`–`5` switch views · `Esc` close
