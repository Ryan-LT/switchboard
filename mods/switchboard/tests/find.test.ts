import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000
const now = Date.now()

/** What the local agent answers, cut to the fields the pane reads. */
const STATE = {
  projects: [
    { key: 'acme-web', name: 'acme-web' },
    { key: 'wedding', name: 'wedding-site' },
  ],
  items: [
    {
      id: 'local_invite',
      title: '#232',
      project: 'acme-web',
      cliSessionId: '11111111-1111-1111-1111-111111111111',
      live: 'idle',
      updatedAt: now - 5 * MIN,
      archived: false,
      aiTitle: 'Invite users without email (#232)',
      about: 'Lets admins invite users who have no email address.',
      summary: 'Waiting on BE for the invite endpoint',
      reading: { o: 'waiting', on: 'be' },
      links: [{ label: 'Issue #232', url: 'https://github.com/o/r/issues/232', state: 'open' }],
      images: [{ id: 'aaaaaaaaaaaaaaaaaaaa' }],
    },
    {
      id: 'local_gallery',
      title: 'Gallery',
      project: 'wedding',
      cliSessionId: '22222222-2222-2222-2222-222222222222',
      live: 'idle',
      updatedAt: now - 20 * 24 * 60 * MIN,
      archived: false,
      aiTitle: 'Upload wedding photos',
      reading: { o: 'done' },
      links: [],
      images: [],
    },
  ],
}

/** What the engine answers beneath the plugin in a real session: the session's start, its commands and clock. */
function engine(on: On) {
  mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.close', async () => ({ value: undefined }))
}

/** A command typed at the prompt. */
const FIND = { command: 'find', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

const ok = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: typeof body === 'string' ? body : JSON.stringify(body) } })

test('a new session only registers /find, closes the old Claude Board pane, and never polls the agent', async ($, on) => {
  const calls: string[] = []
  const opened: string[] = []
  const registered: string[] = []
  on('http.fetch', async (_$, e) => {
    calls.push(e.url)
    return ok(STATE)
  })
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const closed: string[] = []
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  await clock.advance(5 * MIN)
  expect(registered).toEqual(['find'])
  expect(opened).toEqual([])
  expect(closed).toEqual(['claude-board'])
  expect(calls).toEqual([])
})

test('/find says the agent is down instead of failing silently', async ($, on) => {
  on('http.fetch', async () => ({ deny: 'connect ECONNREFUSED 127.0.0.1:4317' }))
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ ...FIND, args: 'invite users without email' })
  expect(ran).toMatchObject({ text: expect.stringContaining("agent isn't answering") })
})

test('/find starts the agent when it is down, then answers', async ($, on) => {
  let started = false
  on('http.fetch', async (_$, e) => {
    if (!started) return { deny: 'connect ECONNREFUSED 127.0.0.1:4317' }
    if (e.url.endsWith('/api/state')) return ok(STATE)
    if (e.url.includes('/api/thumb/')) return ok('data:image/jpeg;base64,AAAA')
    if (e.url.endsWith('/api/search')) return ok({ hits: [{ id: 'local_invite', via: 'link', why: 'Mentions Issue #232', score: 1000 }] })
    if (e.url.endsWith('/api/search/ai')) return ok({ hits: [] })
    return { value: { status: 404, ok: false, headers: {}, text: '{}' } }
  })
  on('process.run', async () => {
    started = true
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.close', async () => ({ value: undefined }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const running = $.command.run({ ...FIND, args: 'https://github.com/o/r/issues/232' })
  await clock.advance(1_000)
  const ran = await running
  expect(started).toBe(true)
  expect(ran).toMatchObject({ text: expect.stringContaining('Invite users without email (#232)') })
})

test('/find answers in the conversation with the chat to continue, as a card with Copy & open', async ($, on) => {
  const calls: string[] = []
  on('http.fetch', async (_$, e) => {
    calls.push(`${e.init?.method ?? 'GET'} ${e.url.replace('http://127.0.0.1:4317', '')}`)
    if (e.url.endsWith('/api/state')) return ok(STATE)
    if (e.url.includes('/api/thumb/')) return ok('data:image/jpeg;base64,AAAA')
    if (e.url.endsWith('/api/search')) return ok({ hits: [{ id: 'local_invite', via: 'link', why: 'Mentions Issue #232', score: 1000 }] })
    if (e.url.endsWith('/api/search/ai')) return ok({ hits: [{ id: 'local_invite', via: 'ai', why: 'Same issue', confidence: 'high', score: 100 }] })
    if (e.url.includes('/open')) return ok({ ok: true })
    return { value: { status: 404, ok: false, headers: {}, text: '{}' } }
  })
  on('ui.copy', async () => ({ value: { isCopied: true as const } }))
  on('ui.toast', async () => ({ value: undefined }))
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  const q = 'QA reopened https://github.com/o/r/issues/232'
  const ran = await $.command.run({ ...FIND, args: q })
  expect(ran).toMatchObject({ text: expect.stringContaining('Invite users without email (#232)') })

  for (const surface of ['desktop', 'terminal'] as const) {
    const row = await $.ui.mount({ plugin: 'switchboard', surface, component: 'CommandOutput', props: { command: 'find', args: q, text: '', isErrored: false } })
    expect(await row.find({ type: 'Text', text: /Mentions Issue #232/ })).toBeDefined()
    if (surface === 'desktop') expect(await row.find({ type: 'Svg' })).toBeDefined()
    expect((await row.find({ key: 'resume-local_invite' }))?.props.label).toBe('Copy & open')
    await row.press({ key: 'resume-local_invite' })
    expect(calls).toContain('POST /api/items/local_invite/open')
    await row.unmount()
  }
})
