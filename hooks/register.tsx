// human-tasks: a persistent pane of actions Claude needs the user to take.
//
// Claude posts a task with the tool mcp__human-tasks__post (a title, the steps or
// commands to run, what to expect, and optional known outcomes). The pane keeps
// every open task on screen. The user ticks a task off, picks one of its
// outcomes, or types a reply, and the mod starts a turn telling Claude.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Board, Mode, Tab, Task, TaskStatus } from '../types'

const PANE = 'human-tasks'
// Not 'tasks': that is a built-in command and the engine refuses it
const COMMAND = 'human-tasks'
const PANE_TITLE = 'Tasks for you'
const MAX_OPTIONS = 6
/** Body rows requested for the inline pane; the default is a third of the screen. */
const PANE_ROWS = 24
/** Finished tasks kept in the store; older ones are dropped. */
const MAX_FINISHED = 50

const board = atom({ plugin: 'human-tasks', key: 'board' } as const, { tasks: [], nextId: 1 } as Board)
const mode = atom({ plugin: 'human-tasks', key: 'mode' } as const, 'unset' as Mode)
const tab = atom({ plugin: 'human-tasks', key: 'tab' } as const, 'open' as Tab)
const expandedIds = atom({ plugin: 'human-tasks', key: 'expandedIds' } as const, [] as number[])
/** False until the board is restored from the store; /clear resets it with the rest of the state. */
const loaded = atom({ plugin: 'human-tasks', key: 'loaded' } as const, false)
const replyingId = atom({ plugin: 'human-tasks', key: 'replyingId' } as const, null as number | null)

type TaskInput = {
  action?: unknown
  id?: unknown
  title?: unknown
  steps?: unknown
  note?: unknown
  expect?: unknown
  options?: unknown
}

/** Not per project: the choice follows the user. */
const MODE_KEY = 'mode'

/** Appended to the system prompt only once the user opts in to automatic use. */
const AUTO_GUIDANCE = `# human-tasks pane
When you need the user to do something only they can do (run a command in their own terminal, check a console or dashboard, make a decision, supply a value), post it with the mcp__human-tasks__task tool instead of asking in chat. One task per independent action, in order.
Check tasks off as you learn they are done. If the user confirms in chat, or pastes output that clearly shows a task's steps succeeded, call the tool with action "complete", the task id and a short note. Use "list" if you need the ids. Never complete a task on ambiguous or failing output: ask, or let the user press Done.`

const label = (t: Task) => `#${t.id} "${t.title}"`

const isFinished = (t: Task) => t.status !== 'open' && t.status !== 'removed'

function parseSteps(raw: unknown): Task['steps'] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      text: s.text ? String(s.text) : '',
      command: s.command ? String(s.command) : '',
    }))
    .filter((s) => s.text || s.command)
}

function parseOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(String).filter(Boolean).slice(0, MAX_OPTIONS)
}

/** Drop removed tasks and cap the finished ones so the store cannot grow without bound. */
function prune(b: Board): Board {
  const kept = b.tasks.filter((t) => t.status !== 'removed')
  const finished = kept.filter(isFinished)
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - MAX_FINISHED)).map((t) => t.id))
  return { ...b, tasks: kept.filter((t) => !drop.has(t.id)) }
}

async function setMode($: Engine, next: Mode) {
  await update($, mode, () => next)
  await $.store.set(MODE_KEY, next)
}

const storeKey = async ($: Engine) => `tasks:${await $.session.root()}`

async function persist($: Engine) {
  await $.store.set(await storeKey($), await read($, board))
}

const paneKey = async ($: Engine) => `pane:${await $.session.root()}`

/** Open the pane and remember it, so /clear (which closes every pane) can put it back. */
async function openPane($: Engine, focus: boolean) {
  await $.store.set(await paneKey($), true)
  return $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS, ...(focus ? { focus } : {}) })
}

/** Load the saved board and mode into the live state. State resets on /clear; the store does not. */
async function restoreState($: Engine) {
  const saved = (await $.store.get(await storeKey($))) as Board | undefined
  if (saved && Array.isArray(saved.tasks)) {
    const nextId = typeof saved.nextId === 'number' ? saved.nextId : saved.tasks.length + 1
    await update($, board, () => ({ tasks: saved.tasks, nextId }))
  }
  const savedMode = await $.store.get(MODE_KEY)
  if (savedMode === 'auto' || savedMode === 'manual') await update($, mode, () => savedMode)
  await update($, loaded, () => true)
}

/** Restore once per state lifetime, so nothing persists an unloaded board over the stored one. */
async function ensureLoaded($: Engine) {
  if (!(await read($, loaded))) await restoreState($)
}

async function mutate($: Engine, fn: (b: Board) => Board) {
  await ensureLoaded($)
  await update($, board, fn)
  await persist($)
}

async function resolveTask(
  $: Engine,
  id: number,
  status: TaskStatus,
  answer: string,
  message: (t: Task) => string,
) {
  let resolved: Task | undefined
  await mutate($, (b) => {
    resolved = undefined
    return {
      ...b,
      tasks: b.tasks.map((t) => {
        if (t.id !== id || t.status !== 'open') return t
        resolved = { ...t, status, answer }
        return resolved
      }),
    }
  })
  // Already resolved or removed (a double press): nothing to tell Claude
  if (!resolved) return
  await update($, replyingId, () => null)
  // Waits for the session to be idle, so do not await it
  void $.prompt.submit({ text: message(resolved) })
}

async function clearCompleted($: Engine) {
  await mutate($, (b) => ({ ...b, tasks: b.tasks.filter((t) => !isFinished(t)) }))
}

async function postTask($: Engine, input: TaskInput) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) return { result: 'A non-empty `title` is required.' }

  let task: Task | undefined
  await mutate($, (b) => {
    task = {
      id: b.nextId,
      title,
      steps: parseSteps(input.steps),
      expect: input.expect ? String(input.expect) : '',
      options: parseOptions(input.options),
      status: 'open',
      answer: '',
    }
    return prune({ tasks: [...b.tasks, task], nextId: b.nextId + 1 })
  })
  if (!task) return { result: 'Could not post the task.' }

  await openPane($, false)
  $.ui.toast(`New task #${task.id}: ${task.title}`)
  return { result: `Posted task #${task.id}. The user will see it in the human-tasks pane (/human-tasks opens it).` }
}

async function removeTask($: Engine, id: number) {
  const { tasks } = await read($, board)
  const found = tasks.find((t) => t.id === id)
  if (!found || found.status === 'removed') return { result: `No task #${id}.` }
  await mutate($, (b) => ({
    ...b,
    tasks: b.tasks.map((t) => (t.id === id ? { ...t, status: 'removed' as const } : t)),
  }))
  return { result: `Removed task #${id}.` }
}

async function completeTask($: Engine, id: number, note: unknown) {
  const { tasks } = await read($, board)
  const found = tasks.find((t) => t.id === id)
  if (!found || found.status === 'removed') return { result: `No task #${id}.` }
  if (found.status !== 'open') return { result: `Task #${id} is already ${found.status}.` }
  const text = typeof note === 'string' ? note.trim() : ''
  await mutate($, (b) => ({
    ...b,
    tasks: b.tasks.map((t) =>
      t.id === id && t.status === 'open' ? { ...t, status: 'done' as const, answer: text } : t,
    ),
  }))
  return { result: `Marked task #${id} done.` }
}

async function listTasks($: Engine) {
  const { tasks } = await read($, board)
  const visible = tasks.filter((t) => t.status !== 'removed')
  if (visible.length === 0) return { result: 'No tasks.' }
  return {
    result: visible
      .map((t) => `#${t.id} [${t.status}] ${t.title}${t.answer ? ` (answer: ${t.answer})` : ''}`)
      .join('\n'),
  }
}

export const register: Register = (on) => {
  let reopenOnPrompt = false

  on('session.start', async ($, e, next) => {
    await restoreState($)
    if ((await read($, mode)) === 'unset') {
      $.ui.toast(`human-tasks: run /${COMMAND} to choose whether Claude uses the task pane automatically`)
    }

    await $.tool.register({
      name: 'task',
      description:
        'Show the user a persistent on-screen task for an action only they can do (e.g. commands to run in their own terminal), instead of burying it in scrolling chat. It stays until they tick it done, pick an outcome or reply; you are then messaged with the task id. action "post" (default) adds one task per independent action, in order; "remove" retracts task `id`; "complete" checks off task `id` when the user has confirmed it in chat or pasted output proving it (add a short `note`); "list" shows tasks, statuses and answers.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['post', 'remove', 'complete', 'list'] },
          title: { type: 'string', description: 'post: short imperative title' },
          steps: {
            type: 'array',
            description: 'post: ordered steps, each with prose `text`, a shell `command` (shown as a code block with a copy control), or both. Keep each command short enough to fit on one line; for anything longer, write a script file and post the command that runs it, because the user pastes these into a terminal',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, command: { type: 'string' } },
            },
          },
          expect: { type: 'string', description: 'post: what the user should see if it worked' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: `post: known outcomes offered as buttons (max ${MAX_OPTIONS})`,
          },
          id: { type: 'number', description: 'remove or complete: task id' },
          note: { type: 'string', description: 'complete: what the user confirmed, in a few words' },
        },
      },
    })
    try {
      await $.command.register({ name: COMMAND, description: 'Show the human-tasks pane', immediate: true })
    } catch (err) {
      $.ui.log(`could not register /${COMMAND}: ${String(err)}`)
    }
    return next(e)
  })

  // /clear resets the state but not the store, and session.start never fires for it
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear') {
      await restoreState($)
      if ((await $.store.get(await paneKey($))) === true) {
        await openPane($, false)
        reopenOnPrompt = true
      }
    }
    return result
  })

  // Only the person or this mod closing the pane means "leave it shut"; an unload (/clear) does not
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin !== 'unload') await $.store.set(await paneKey($), false)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__human-tasks__task' }, async ($, e) => {
    await ensureLoaded($)
    const input = e as unknown as TaskInput
    switch (input.action ?? 'post') {
      case 'post':
        return postTask($, input)
      case 'remove':
        return removeTask($, Number(input.id))
      case 'complete':
        return completeTask($, Number(input.id), input.note)
      case 'list':
        return listTasks($)
      default:
        return { result: 'Unknown action. Use post, remove, complete or list.' }
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    // The /clear teardown can land after SessionStart and swallow that open, so retry on the first prompt
    if (reopenOnPrompt) {
      reopenOnPrompt = false
      if ((await $.store.get(await paneKey($))) === true) await openPane($, false)
    }
    if ((await $.store.get(MODE_KEY)) !== 'auto') return result
    return {
      sections: [...result.sections, { id: 'human-tasks:guidance', text: AUTO_GUIDANCE, scope: 'session' as const }],
    }
  })

  on('command.run', { command: COMMAND }, async ($) => {
    await ensureLoaded($)
    await openPane($, true)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Code, Markdown } = ui
    // Not every surface can draw a text input; those fall back to buttons only
    const Input = 'Input' in ui ? ui.Input : undefined
    const { tasks } = await read($, board)
    const replying = await read($, replyingId)
    const currentMode = await read($, mode)
    const currentTab = await read($, tab)
    const expanded = await read($, expandedIds)
    const open = tasks.filter((t) => t.status === 'open')
    // Newest first
    const finished = tasks.filter(isFinished).reverse()
    const ruleWidth = Math.max(10, e.props.bodyColumns)
    // A run of box-drawing characters renders as two lines on the desktop, so it draws a markdown rule
    const rule = (key: string) =>
      e.surface === 'terminal' ? (
        <Text key={key} dimColor>
          {'─'.repeat(ruleWidth)}
        </Text>
      ) : (
        <Markdown key={key} text="---" dimColor />
      )

    const tabButton = (id: Tab, name: string, count: number) => (
      <Button
        key={`tab-${id}`}
        label={`${currentTab === id ? '●' : '○'} ${name} (${count})`}
        onPress={() => update($, tab, () => id)}
      />
    )

    const modeButton =
      currentMode !== 'unset' ? (
        <Button
          key="mode-toggle"
          label={currentMode === 'auto' ? 'Auto: on' : 'Auto: off'}
          onPress={() => setMode($, currentMode === 'auto' ? 'manual' : 'auto')}
        />
      ) : null

    const tabs = (
      <Box key="tabs" flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" columnGap={1}>
            {tabButton('open', 'Open', open.length)}
            {tabButton('completed', 'Completed', finished.length)}
          </Box>
          {modeButton}
        </Box>
        {rule('tabs-rule')}
      </Box>
    )

    const onboarding = currentMode === 'unset' && (
      <Box key="onboarding" flexDirection="column" marginBottom={1}>
        <Text bold>Let Claude use this pane on its own?</Text>
        <Text wrap="wrap" dimColor>
          Claude would post anything only you can do here, and check tasks off when you confirm them in chat.
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="mode-auto" label="Yes, automatically" onPress={() => setMode($, 'auto')} />
          <Button key="mode-manual" label="Only when I ask" onPress={() => setMode($, 'manual')} />
        </Box>
      </Box>
    )

    if (currentTab === 'completed') {
      return (
        <Box flexDirection="column">
          {tabs}
          {finished.length === 0 && <Text dimColor>Nothing completed yet.</Text>}
          {finished.map((t, idx) => {
            const isOpen = expanded.includes(t.id)
            return (
              <Box key={`fin-${t.id}`} flexDirection="column">
                {idx > 0 && rule(`fin-rule-${t.id}`)}
                <Box flexDirection="row">
                  <Button
                    key={`toggle-${t.id}`}
                    label={`${isOpen ? '▾' : '▸'} ✓ #${t.id}  ${t.title}`}
                    onPress={() =>
                      update($, expandedIds, (ids) => (ids.includes(t.id) ? ids.filter((i) => i !== t.id) : [...ids, t.id]))
                    }
                  />
                </Box>
                {isOpen && (
                  <Box flexDirection="column" paddingLeft={2}>
                    {t.steps.map((st, i) => (
                      <Box key={`fstep-${t.id}-${i}`} flexDirection="column">
                        {st.text && <Text dimColor wrap="wrap">{`${i + 1}. ${st.text}`}</Text>}
                        {st.command && <Code source={st.command} language="sh" />}
                      </Box>
                    ))}
                    {t.expect && <Text dimColor wrap="wrap">{`Expect: ${t.expect}`}</Text>}
                    <Text wrap="wrap">{t.answer ? `${t.status}: ${t.answer}` : t.status}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
          {finished.length > 0 && (
            <Box key="clear" marginTop={1}>
              <Button label={`Clear completed (${finished.length})`} onPress={() => clearCompleted($)} />
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {tabs}
        {onboarding}
        {open.length === 0 && <Text dimColor>Nothing for you to do right now.</Text>}
        {open.map((t, idx) => (
          <Box key={`task-${t.id}`} flexDirection="column">
            {idx > 0 && rule(`rule-${t.id}`)}
            <Text bold>{`#${t.id}  ${t.title}`}</Text>
            {t.steps.map((s, i) => (
              <Box key={`step-${i}`} flexDirection="column">
                {s.text && <Text wrap="wrap">{`${i + 1}. ${s.text}`}</Text>}
                {s.command && e.surface === 'terminal' && (
                  <Button
                    key={`copy-${t.id}-${i}`}
                    label="Copy"
                    onPress={async (press) => {
                      // Selecting wrapped text copies the soft wraps as newlines; this copies the raw command
                      const { isCopied } = await $.ui.copy({ text: s.command, surface: press.surface })
                      $.ui.toast(isCopied ? 'Command copied' : 'Could not copy the command')
                    }}
                  />
                )}
                {s.command && <Code source={s.command} language="sh" />}
              </Box>
            ))}
            {t.expect && (
              <Text dimColor wrap="wrap">
                {`Expect: ${t.expect}`}
              </Text>
            )}
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Button
                label="Done"
                onPress={() =>
                  resolveTask($, t.id, 'done', '', (r) => `The user ticked off task ${label(r)} as done.`)
                }
              />
              {t.options.map((opt, j) => (
                <Button
                  key={`opt-${j}`}
                  label={opt}
                  onPress={() =>
                    resolveTask($, t.id, 'chosen', opt, (r) => `For task ${label(r)} the user chose: "${opt}".`)
                  }
                />
              ))}
              {Input && (
                <Button
                  label={replying === t.id ? 'Cancel reply' : 'Reply'}
                  onPress={() => update($, replyingId, (cur) => (cur === t.id ? null : t.id))}
                />
              )}
            </Box>
            {Input && replying === t.id && (
              <Input
                key={`input-${t.id}`}
                label="Reply"
                placeholder="What happened? Paste output or describe it"
                value=""
                submitLabel="send"
                autoFocus
                onSubmit={async (value: unknown) => {
                  const text = String(value ?? '').trim()
                  if (!text) return
                  await resolveTask(
                    $,
                    t.id,
                    'replied',
                    text,
                    (r) => `The user replied on task ${label(r)}:\n\n${text}`,
                  )
                }}
              />
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
