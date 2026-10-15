import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { BoardCard, BoardFind, BoardHit } from '../types'
import { ago, FIND_THUMB, looksLikeMessage, sections, THUMB, thumbSvg, toCards } from './board'

/**
 * /find inside Claude Code: which chat a teammate's reply, an issue link or a description belongs to, answered
 * in the conversation with a button to continue it. The local Claude Board agent (apps/agent in this repo's
 * clone, $SWITCHBOARD_DIR) reads the chats; this mod only asks it and draws the answer.
 * Nothing runs until /find is typed: no pane, no polling.
 */

const AGENT = 'http://127.0.0.1:4317'
/** Where the Switchboard repo is cloned, to start the agent when it isn't running. */
const REPO = '"${SWITCHBOARD_DIR:-$HOME/Desktop/source_code/personal/switchboard}"'

const cards = atom({ plugin: 'switchboard', key: 'cards' } as const, [])
const thumbs = atom({ plugin: 'switchboard', key: 'thumbs' } as const, {})
const finds = atom({ plugin: 'switchboard', key: 'finds' } as const, {})

async function call<T>($: EngineInterface, path: string, body?: unknown): Promise<T> {
  const r = await $.http.fetch(AGENT + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) {
    let message = `The agent answered ${r.status}`
    try {
      message = JSON.parse(r.text).error ?? message
    } catch {
      /* not JSON */
    }
    throw new Error(message)
  }
  return JSON.parse(r.text) as T
}

/** Stored by picture and size, so a change of size fetches new pictures instead of reusing old ones. */
const picKey = (id: string) => `${id}@${THUMB.w * 2}`

const loading = new Set<string>()

/** Pictures come one at a time, each a small JPEG the agent makes once; archived chats' too. */
async function loadThumbs($: EngineInterface, list: BoardCard[]) {
  const have = await read($, thumbs)
  for (const c of list) {
    const id = c.image
    if (!id || have[picKey(id)] || loading.has(id)) continue
    loading.add(id)
    try {
      const r = await $.http.fetch(`${AGENT}/api/thumb/${id}?w=${THUMB.w * 2}`)
      if (r.ok && r.text.startsWith('data:image/')) await update($, thumbs, (t) => ({ ...t, [picKey(id)]: r.text }))
    } finally {
      loading.delete(id)
    }
  }
}

/** Reloads the chats, once per /find: the answer names chats by these cards. */
async function refresh($: EngineInterface) {
  const next = toCards(await call($, '/api/state'), Date.now())
  if (JSON.stringify(await read($, cards)) !== JSON.stringify(next)) await update($, cards, () => next)
}

/** Starts the agent in the background and waits, up to 20 seconds, for it to answer. */
async function startAgent($: EngineInterface) {
  await $.process.run(['/bin/zsh', '-lc', `cd ${REPO} && (nohup pnpm --filter @switchboard/agent start > /tmp/claude-board-agent.log 2>&1 &)`], { timeoutMs: 15_000 })
  for (let i = 0; i < 20; i++) {
    await $.clock.sleep(1_000)
    try {
      return void (await refresh($))
    } catch {
      /* not up yet */
    }
  }
  throw new Error('it did not start; see /tmp/claude-board-agent.log')
}

/** Opens the chat in Claude. From a search, the message you pasted goes to the clipboard first. */
async function resume($: EngineInterface, c: BoardCard, copyText: string | undefined, surface: RenderSurface) {
  let copied = false
  if (copyText) copied = (await $.ui.copy({ text: copyText.trim(), surface })).isCopied
  try {
    await call($, `/api/items/${encodeURIComponent(c.id)}/open`, {})
    $.ui.toast(copied ? `Message copied. Opening “${c.title}”: paste it with ⌘V.` : `Opening “${c.title}”`)
  } catch (e) {
    $.ui.toast(e instanceof Error ? e.message : 'Could not open the chat')
  }
}

type Els = ReturnType<EngineInterface['ui']['resolve']>

/**
 * One /find answer line: short, so the whole answer fits on screen once the conversation scrolls to it.
 * Title, where and when, why it matched, and the button to continue.
 */
function findLine(el: Els, $: EngineInterface, c: BoardCard, why: BoardHit, now: number, pic: string | undefined, copyText?: string) {
  const { Box, Text, Button } = el
  const Svg = 'Svg' in el ? el.Svg : undefined
  return (
    <Box key={`find-${c.id}`} flexDirection="row" columnGap={2} alignItems="center" marginBottom={1}>
      {Svg && pic && (
        <Box flexShrink={0}>
          <Svg source={thumbSvg(pic, FIND_THUMB.w, FIND_THUMB.h)} alt={`A picture from “${c.title}”`} width={FIND_THUMB.w} height={FIND_THUMB.h} />
        </Box>
      )}
      {/* minWidth 0 lets the text column give way, so long text truncates instead of pushing the button out. */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold>{c.title}</Text>
          <Text dimColor>
            {' '}
            · {c.projectName} · {ago(c.at, now)}
          </Text>
          {c.archived && <Text color="warning"> · {c.label}</Text>}
        </Text>
        <Text color={why.via === 'ai' ? 'claude' : 'success'} wrap="truncate-end">
          {why.via === 'ai' ? '✦ ' : why.via === 'link' ? '🔗 ' : ''}
          {why.why}
        </Text>
      </Box>
      {c.canResume && (
        <Box flexShrink={0}>
          <Button key={`resume-${c.id}`} variant="primary" label={copyText ? 'Copy & open' : 'Resume'} onPress={(pe) => void resume($, c, copyText, pe.surface)} />
        </Box>
      )}
    </Box>
  )
}

/** /find: the chats a prompt, link or reply belongs to, most certain first (links, Claude's pick, words). */
async function findChats($: EngineInterface, q: string): Promise<BoardFind> {
  try {
    const [{ hits: quickHits }, aiResult] = await Promise.all([
      call<{ hits: BoardHit[] }>($, '/api/search', { q }),
      call<{ hits: BoardHit[] }>($, '/api/search/ai', { q }).then(
        (r) => ({ ok: true as const, hits: r.hits }),
        (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'Claude search failed' }),
      ),
    ])
    const list = await read($, cards)
    const known = (id: string) => list.some((c) => c.id === id)
    const { exact, picks, words } = sections(q, quickHits, aiResult.ok ? { status: 'done', q, hits: aiResult.hits } : { status: 'idle' }, known)
    return { status: 'done', hits: [...exact, ...picks, ...words.slice(0, 2)], error: aiResult.ok ? undefined : aiResult.error }
  } catch (e) {
    return { status: 'error', hits: [], error: e instanceof Error ? e.message : 'Search failed' }
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'find', description: 'Find the chat to continue for a prompt, issue/PR link or teammate reply', argumentHint: '<reply, link or task>' })
    // Earlier versions opened a Claude Board pane at every start; close one left on screen.
    try {
      await $.ui.close({ id: 'claude-board' })
    } catch {
      /* not open, or no surface to close it on */
    }
    return next(e)
  })

  on('command.run', { command: 'find' }, async ($, e) => {
    const q = e.args.trim()
    if (!q) return { text: 'Usage: /find <a teammate reply, an issue/PR link or a task>' }
    await update($, finds, (f): Record<string, BoardFind> => ({ ...f, [q]: { status: 'loading', hits: [] } }))
    try {
      // The agent isn't running: start it once, then search.
      await refresh($).catch(() => startAgent($))
    } catch (err) {
      const found: BoardFind = { status: 'error', hits: [], error: `the Claude Board agent isn't answering at ${AGENT} (${err instanceof Error ? err.message : 'no reply'})` }
      await update($, finds, (f) => ({ ...f, [q]: found }))
      return { text: `Couldn't search: ${found.error}` }
    }
    const found = await findChats($, q)
    await update($, finds, (f) => ({ ...Object.fromEntries(Object.entries(f).slice(-20)), [q]: found }))
    const list = await read($, cards)
    // Pictures for the chats it found, archived ones too, before the row draws.
    await loadThumbs($, found.hits.slice(0, 4).map((h) => list.find((c) => c.id === h.id)).filter((c): c is BoardCard => !!c))
    const lines = found.hits.map((h, i) => {
      const c = list.find((x) => x.id === h.id)
      return c ? `${i + 1}. ${c.title} (${c.projectName}, ${ago(c.at, Date.now())}): ${h.why}` : ''
    })
    return {
      text: found.status === 'error' ? `Couldn't search: ${found.error}` : found.hits.length ? `Chats to continue:\n${lines.filter(Boolean).join('\n')}` : 'No chat matches this. It may be new work.',
    }
  })

  /** /find's answer drawn right in the conversation, each line with Resume (or Copy & open for a pasted reply). */
  on('ui.render', { component: 'CommandOutput', props: { command: 'find' } }, async ($, e, next) => {
    const q = e.props.args.trim()
    const [all, list, pics] = await Promise.all([read($, finds), read($, cards), read($, thumbs)])
    const found = all[q]
    if (!q || !found) return next(e)
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const now = Date.now()
    const copyText = looksLikeMessage(q) ? q : undefined
    return (
      <Box flexDirection="column">
        {found.status === 'loading' && <Text color="claude">Claude is reading your chats…</Text>}
        {found.status === 'error' && <Text color="error">Couldn't search: {found.error}</Text>}
        {found.status === 'done' && !found.hits.length && <Text dimColor>No chat matches this. It may be new work.</Text>}
        {found.status === 'done' && found.error && <Text dimColor>Claude couldn't rank these ({found.error}); showing link and word matches.</Text>}
        {found.hits.slice(0, 4).map((h) => {
          const c = list.find((x) => x.id === h.id)
          return c ? findLine(el, $, c, h, now, c.image ? pics[picKey(c.image)] : undefined, copyText) : null
        })}
        {found.hits.length > 4 && <Text dimColor>+{found.hits.length - 4} more</Text>}
      </Box>
    )
  })
}
