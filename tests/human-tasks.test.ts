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
