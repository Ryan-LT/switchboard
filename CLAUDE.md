# Claude Board (switchboard)

pnpm monorepo: `apps/agent` (Node backend that reads Claude sessions locally) and `apps/web` (React + Vite UI).

The app exists to answer one question fast: "a teammate replied about X; which Claude chat do I continue?" Keep the UI minimal: cards grouped by project (title, description, status, 1–2 images, issue/PR links, last-message time, Resume) and one search box. No stats or token meters in the UI.

## Agent

- Reads Claude's own files (`~/.claude/projects/*.jsonl`, the desktop app's session store). It never writes to them.
- `links.ts`: issue/PR/Figma/Slack links and `#123` refs per chat. `images.ts`: pasted screenshots and issue/PR body images, served from `/api/img/:id`.
- `summaries.ts`: each card's title, description and status, written by `claude -p` (Sonnet) once a chat goes quiet, only for new messages, under a daily token cap.
- `search.ts`: instant link and word ranking (`POST /api/search`, free), then Claude's pick (`POST /api/search/ai`, a few thousand tokens per search).

## Claude Code mod (`mods/switchboard`)

`/find <reply, link or task>` inside Claude Code, answered in the conversation from the agent's API (`/api/state`, `/api/search`, `/api/search/ai`, `/api/thumb/:id`). Only `/find`: no pane, nothing that opens or polls on its own. Installed from this folder (`switchboard@switchboard-mods`, user scope): edit it here and run `/reload-plugins`. Check with `claude plugin validate mods/switchboard` and `claude plugin test mods/switchboard`.

## Web architecture: Feature-Sliced Design v2.1

`apps/web/src` follows FSD. Read the skill at `.claude/skills/feature-sliced-design/SKILL.md` before adding or moving code.

- Layers in use: `app` → `pages` → `shared`. It's a one-page app, so per "pages first" everything specific to it lives in `pages/home` (`model/` and `ui/`). Extract to `features`/`entities` only when a second page needs the code.
- Import only from lower layers. Import other slices through their public `index.ts` with the `@/` alias; inside a slice, use relative imports.
- `shared` holds no business logic; each segment (`api`, `lib`, `ui`) has its own index.
- Check with `pnpm lint:fsd` (Steiger).

FSD does not cover `apps/agent`.

## Checks

`pnpm typecheck && pnpm lint:fsd && pnpm test && pnpm build`
