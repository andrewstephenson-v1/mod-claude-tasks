import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// The test harness has no store beneath the plugin; answer it from memory.
function memoryStore(on: On) {
  const store = new Map<string, unknown>()
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
