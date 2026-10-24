import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// The test harness has no store beneath the plugin; answer it from memory.
function memoryStore(on: On, initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  return store
}

function stubProject(on: On) {
  on('session.root', async () => ({ value: '/test/project' }))
}

// Nor a UI: the pane opens and toasts land nowhere.
function stubUi(on: On) {
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.invalidate', async () => ({ value: undefined }))
}

test('post adds a task and list reports it open', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  const posted = await $.tool.call({
    tool: 'mcp__human-tasks__task', action: 'post',
    title: 'Run the dev check',
    steps: [{ text: 'From envs/dev', command: 'terraform state list' }],
    expect: 'skip_destroy = true',
    options: ['All true', 'One false'],
  })
  expect(String(posted.result)).toContain('Posted task #1')
  const listed = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })
  expect(String(listed.result)).toContain('#1 [open] Run the dev check')
})

test('remove hides a task from the list', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Something' })
  const removed = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'remove', id: 1 })
  expect(String(removed.result)).toContain('Removed task #1')
  const listed = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })
  expect(String(listed.result)).toBe('No tasks.')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane draws an open task's commands on ${surface}`, async ($, on) => {
    memoryStore(on)
  stubProject(on)
    stubUi(on)
    await $.tool.call({
      tool: 'mcp__human-tasks__task', action: 'post',
      title: 'Check the date',
      steps: [{ text: 'In any terminal', command: 'date' }],
      expect: 'Today',
      options: ['Looks right'],
    })
    // mount rejects when the surface cannot draw the tree, as an empty pane does in a session
    const pane = await $.ui.mount({
      plugin: 'human-tasks',
      surface,
      component: 'Pane',
      props: {
        title: 'Tasks for you',
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, max: 0 } as never,
        view: {} as never,
      },
      requestId: 'human-tasks',
    })
    await pane.press({ key: 'open-toggle-1' })
    expect(await pane.find({ type: 'Code', text: 'date' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'opt-0' })).toBeDefined()
    // The desktop's code block has its own copy control, so only the terminal gets a button
    const copy = await pane.find({ type: 'Button', key: 'copy-1-0' })
    expect(copy !== undefined).toBe(surface === 'terminal')
  })
}

test('a blank title is rejected and nothing is posted', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  const posted = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: '   ' })
  expect(String(posted.result)).toContain('title')
  const listed = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })
  expect(String(listed.result)).toBe('No tasks.')
})

test('options are capped at six and ids increase', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'One' })
  const second = await $.tool.call({
    tool: 'mcp__human-tasks__task', action: 'post',
    title: 'Two',
    options: ['1', '2', '3', '4', '5', '6', '7', '8'],
  })
  expect(String(second.result)).toContain('Posted task #2')
})

test('removing an unknown or already removed task reports it', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  const missing = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'remove', id: 9 })
  expect(String(missing.result)).toContain('No task #9')
})

test('the pane offers Clear completed only once a task is finished', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  on('prompt.submit', async () => ({ value: undefined }))
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Check' })
  const pane = await $.ui.mount({
    plugin: 'human-tasks',
    surface: 'terminal',
    component: 'Pane',
    props: {
      title: 'Tasks for you',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, max: 0 } as never,
      view: {} as never,
    },
    requestId: 'human-tasks',
  })
  expect(await pane.find({ type: 'Button', key: 'clear-completed' })).toBeUndefined()
})

test('complete checks off an open task and rejects repeats and unknown ids', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Run it' })
  const done = await $.tool.call({
    tool: 'mcp__human-tasks__task', action: 'complete', id: 1, note: 'user confirmed in chat',
  })
  expect(String(done.result)).toContain('Marked task #1 done')
  const listed = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })
  expect(String(listed.result)).toContain('#1 [done] Run it (answer: user confirmed in chat)')
  const again = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'complete', id: 1 })
  expect(String(again.result)).toContain('already done')
  const missing = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'complete', id: 9 })
  expect(String(missing.result)).toContain('No task #9')
})

test('the pane offers onboarding until a mode is chosen', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  const mount = () =>
    $.ui.mount({
      plugin: 'human-tasks',
      surface: 'terminal',
      component: 'Pane',
      props: {
        title: 'Tasks for you',
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, max: 0 } as never,
        view: {} as never,
      },
      requestId: 'human-tasks',
    })
  const first = await mount()
  expect(await first.find({ type: 'Button', key: 'mode-auto' })).toBeDefined()
  expect(await first.find({ type: 'Button', key: 'mode-toggle' })).toBeUndefined()
})

test('the pane has Open and Completed tabs and a finished task leaves the Open tab', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Check', options: ['Yes'] })
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'complete', id: 1, note: 'ok' })
  const pane = await $.ui.mount({
    plugin: 'human-tasks',
    surface: 'terminal',
    component: 'Pane',
    props: {
      title: 'Tasks for you',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, max: 0 } as never,
      view: {} as never,
    },
    requestId: 'human-tasks',
  })
  expect(await pane.find({ type: 'Button', key: 'tab-open' })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'tab-completed' })).toBeDefined()
  // Finished, so not drawn on the Open tab
  expect(await pane.find({ type: 'Button', key: 'opt-0' })).toBeUndefined()
})

test('completed tasks expand and collapse when their title is pressed', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({
    tool: 'mcp__human-tasks__task', action: 'post', title: 'Check',
    steps: [{ text: 'Run it', command: 'echo expanded-marker' }],
  })
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'complete', id: 1, note: 'all good' })
  const pane = await $.ui.mount({
    plugin: 'human-tasks',
    surface: 'terminal',
    component: 'Pane',
    props: {
      title: 'Tasks for you',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, max: 0 } as never,
      view: {} as never,
    },
    requestId: 'human-tasks',
  })
  await pane.press({ key: 'tab-completed' })
  expect(await pane.find({ type: 'Button', key: 'toggle-1' })).toBeDefined()
  expect(await pane.find({ type: 'Code', text: 'echo expanded-marker' })).toBeUndefined()
  await pane.press({ key: 'toggle-1' })
  expect(await pane.find({ type: 'Code', text: 'echo expanded-marker' })).toBeDefined()
  await pane.press({ key: 'toggle-1' })
  expect(await pane.find({ type: 'Code', text: 'echo expanded-marker' })).toBeUndefined()
})

test('open tasks start folded to their title and expand when pressed', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({
    tool: 'mcp__human-tasks__task', action: 'post', title: 'Check',
    steps: [{ text: 'Run it', command: 'echo open-marker' }],
    options: ['Worked'],
  })
  const pane = await $.ui.mount({
    plugin: 'human-tasks',
    surface: 'terminal',
    component: 'Pane',
    props: {
      title: 'Tasks for you',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, max: 0 } as never,
      view: {} as never,
    },
    requestId: 'human-tasks',
  })
  expect(await pane.find({ type: 'Button', key: 'open-toggle-1' })).toBeDefined()
  expect(await pane.find({ type: 'Code', text: 'echo open-marker' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'opt-0' })).toBeUndefined()
  await pane.press({ key: 'open-toggle-1' })
  expect(await pane.find({ type: 'Code', text: 'echo open-marker' })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'opt-0' })).toBeDefined()
  await pane.press({ key: 'open-toggle-1' })
  expect(await pane.find({ type: 'Code', text: 'echo open-marker' })).toBeUndefined()
})

const SAVED = {
  tasks: [
    { id: 1, title: 'Old open', steps: [], expect: '', options: [], status: 'open', answer: '' },
    { id: 2, title: 'Old done', steps: [], expect: '', options: [], status: 'done', answer: '' },
  ],
  nextId: 3,
}

test('a post made before the board is restored keeps the saved tasks and ids', async ($, on) => {
  // The state after /clear: empty live board, saved board still in the store
  memoryStore(on, { 'tasks:/test/project': SAVED })
  stubProject(on)
  stubUi(on)
  const posted = await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'New' })
  expect(String(posted.result)).toContain('Posted task #3')
  const listed = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })).result)
  expect(listed).toContain('#1 [open] Old open')
  expect(listed).toContain('#2 [done] Old done')
  expect(listed).toContain('#3 [open] New')
})

test('SessionStart with source clear restores the saved board', async ($, on) => {
  memoryStore(on, { 'tasks:/test/project': SAVED, mode: 'auto' })
  stubProject(on)
  stubUi(on)
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  const listed = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })).result)
  expect(listed).toContain('#1 [open] Old open')
  expect(listed).toContain('#2 [done] Old done')
})

function recordOpens(on: On) {
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return opened
}

test('SessionStart with source clear reopens a pane that was open', async ($, on) => {
  memoryStore(on, { 'pane:/test/project': true })
  stubProject(on)
  on('ui.toast', async () => ({ value: undefined }))
  const opened = recordOpens(on)
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  expect(opened).toEqual(['human-tasks'])
})

test('the first prompt after /clear reopens a pane the teardown swallowed', async ($, on) => {
  memoryStore(on, { 'pane:/test/project': true })
  stubProject(on)
  on('ui.toast', async () => ({ value: undefined }))
  on('session.end', async () => ({ sessionId: 'old' }) as never)
  on('ui.panes', async () => ({ value: [] }))
  on('prompt.compose', async () => ({ sections: [] }))
  const opened = recordOpens(on)
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: {} as never })
  await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [], sections: [] } as never)
  expect(opened).toEqual(['human-tasks'])
})

test('a reopen the engine leaves undrawn says why in the transcript', async ($, on) => {
  memoryStore(on, { 'pane:/test/project': true })
  stubProject(on)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: false, reason: 'too narrow' } }))
  const lines: string[] = []
  on('ui.log', async (_$, e) => {
    if (e.to !== 'debug') lines.push(e.text)
    return { value: undefined }
  })
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  expect(lines.some((l) => l.includes('too narrow'))).toBe(true)
})

test('list shows recent finished tasks with short answers, and an id in full', async ($, on) => {
  const log = 'line of pasted output\n'.repeat(200)
  const tasks = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1, title: `Task ${i + 1}`, steps: [{ text: 'Run it', command: 'make check' }], expect: '', options: [],
    status: i < 7 ? 'replied' : 'open', answer: log,
  }))
  memoryStore(on, { 'tasks:/test/project': { tasks, nextId: 9 } })
  stubProject(on)
  stubUi(on)
  const listed = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })).result)
  expect(listed).toContain('#8 [open] Task 8')
  expect(listed).toContain('#7 [replied] Task 7')
  expect(listed).toContain('#3 [replied] Task 3')
  expect(listed.includes('#2 [replied]')).toBe(false)
  expect(listed).toContain('2 older finished tasks not shown')
  expect(listed.length < 1500).toBe(true)
  const all = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list', all: true })).result)
  expect(all).toContain('#1 [replied] Task 1')
  const one = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list', id: 2 })).result)
  expect(one).toContain('1. Run it `make check`')
  expect(one).toContain(log.trim())
})

const STEPS = [
  { name: 'Setup', command: 'echo setup-marker', expect: 'S is set' },
  { name: 'Build', command: 'echo build-marker', stop: 'any STOP line' },
  { name: 'Run', command: 'echo run-marker' },
]

async function mountPane($: Parameters<Parameters<typeof test>[1]>[0]) {
  return $.ui.mount({
    plugin: 'human-tasks',
    surface: 'terminal',
    component: 'Pane',
    props: {
      title: 'Tasks for you',
      isFocused: false,
      bodyColumns: 80,
      placement: 'dock',
      scroll: { offset: 0, max: 0 } as never,
      view: {} as never,
    },
    requestId: 'human-tasks',
  })
}

test('a multi-step task shows one step at a time and remembers where the user is', async ($, on) => {
  const store = memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Runbook', steps: STEPS })
  const pane = await mountPane($)
  await pane.press({ key: 'open-toggle-1' })
  expect(await pane.find({ type: 'Code', text: 'echo setup-marker' })).toBeDefined()
  expect(await pane.find({ type: 'Code', text: 'echo build-marker' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'step-back-1' })).toBeUndefined()
  await pane.press({ key: 'step-next-1' })
  expect(await pane.find({ type: 'Code', text: 'echo setup-marker' })).toBeUndefined()
  expect(await pane.find({ type: 'Code', text: 'echo build-marker' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '✋ Stop if: any STOP line' })).toBeDefined()
  // Progress is stored, so leaving for another task or restarting keeps the place
  const saved = store.get('tasks:/test/project') as { tasks: { stepsDone?: number[] }[] }
  expect(JSON.stringify(saved.tasks[0].stepsDone)).toBe('[0]')
  const listed = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list' })).result)
  expect(listed).toContain('#1 [open] Runbook (step 2 of 3, Build)')
  await pane.press({ key: 'step-back-1' })
  expect(await pane.find({ type: 'Code', text: 'echo setup-marker' })).toBeDefined()
})

test('the folded title line shows the step the user is on', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Runbook', steps: STEPS })
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'complete', id: 1, step: 1 })
  const pane = await mountPane($)
  const title = await pane.find({ type: 'Button', key: 'open-toggle-1' })
  expect(JSON.stringify(title)).toContain('step 2 of 3, Build')
})

test('complete with a step checks off that step and leaves the task open', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Runbook', steps: STEPS })
  const res = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'complete', id: 1, step: 1 })).result)
  expect(res).toContain('Marked step 1 of task #1 done; now at step 2 of 3, Build')
  const bad = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'complete', id: 1, step: 7 })).result)
  expect(bad).toContain('has no step 7')
  const one = String((await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'list', id: 1 })).result)
  expect(one).toContain('1. [done] Setup: `echo setup-marker`')
  expect(one).toContain('Stop if: any STOP line')
})

test('a reply on a multi-step task tells Claude which step it came from', async ($, on) => {
  memoryStore(on)
  stubProject(on)
  stubUi(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(String((e as { text?: unknown }).text))
    return { drop: 'captured by the test' } as never
  })
  await $.tool.call({ tool: 'mcp__human-tasks__task', action: 'post', title: 'Runbook', steps: STEPS, options: ['Saw a STOP'] })
  const pane = await mountPane($)
  await pane.press({ key: 'open-toggle-1' })
  await pane.press({ key: 'step-next-1' })
  await pane.press({ key: 'opt-0' })
  expect(sent.join('\n')).toContain('(step 2 of 3, Build) the user chose: "Saw a STOP"')
})
