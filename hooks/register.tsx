// human-tasks: a persistent pane of actions Claude needs the user to take.
//
// Claude posts a task with the tool mcp__human-tasks__post (a title, the steps or
// commands to run, what to expect, and optional known outcomes). The pane keeps
// every open task on screen. The user ticks a task off, picks one of its
// outcomes, or types a reply, and the mod starts a turn telling Claude.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Board, Task, TaskStatus } from '../types'

const PANE = 'human-tasks'
// Not 'tasks': that is a built-in command and the engine refuses it
const COMMAND = 'human-tasks'
const PANE_TITLE = 'Tasks for you'
const MAX_OPTIONS = 6
/** Body rows requested for the inline pane; the default is a third of the screen. */
const PANE_ROWS = 24
/** Finished tasks kept in the store; older ones are dropped. */
const MAX_FINISHED = 50
/** Finished tasks shown under the open ones. */
const SHOWN_FINISHED = 3

const board = atom({ plugin: 'human-tasks', key: 'board' } as const, { tasks: [], nextId: 1 } as Board)
const replyingId = atom({ plugin: 'human-tasks', key: 'replyingId' } as const, null as number | null)

type TaskInput = {
  action?: unknown
  id?: unknown
  title?: unknown
  steps?: unknown
  expect?: unknown
  options?: unknown
}

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

const storeKey = async ($: Engine) => `tasks:${await $.session.root()}`

async function persist($: Engine) {
  await $.store.set(await storeKey($), await read($, board))
}

async function mutate($: Engine, fn: (b: Board) => Board) {
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

  await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS })
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
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(await storeKey($))) as Board | undefined
    if (saved && Array.isArray(saved.tasks)) {
      const nextId = typeof saved.nextId === 'number' ? saved.nextId : saved.tasks.length + 1
      await update($, board, () => ({ tasks: saved.tasks, nextId }))
    }

    await $.tool.register({
      name: 'task',
      description:
        'Show the user a persistent on-screen task for an action only they can do (e.g. commands to run in their own terminal), instead of burying it in scrolling chat. It stays until they tick it done, pick an outcome or reply; you are then messaged with the task id. action "post" (default) adds one task per independent action, in order; "remove" retracts task `id`; "list" shows tasks, statuses and answers.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['post', 'remove', 'list'] },
          title: { type: 'string', description: 'post: short imperative title' },
          steps: {
            type: 'array',
            description: 'post: ordered steps, each with prose `text`, a shell `command` (shown as a code block), or both',
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
          id: { type: 'number', description: 'remove: task id' },
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

  on('tool.call', { tool: 'mcp__human-tasks__task' }, async ($, e) => {
    const input = e as unknown as TaskInput
    switch (input.action ?? 'post') {
      case 'post':
        return postTask($, input)
      case 'remove':
        return removeTask($, Number(input.id))
      case 'list':
        return listTasks($)
      default:
        return { result: 'Unknown action. Use post, remove or list.' }
    }
  })

  on('command.run', { command: COMMAND }, async ($) => {
    await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, rows: PANE_ROWS })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Code } = ui
    // Not every surface can draw a text input; those fall back to buttons only
    const Input = 'Input' in ui ? ui.Input : undefined
    const { tasks } = await read($, board)
    const replying = await read($, replyingId)
    const open = tasks.filter((t) => t.status === 'open')
    const allFinished = tasks.filter(isFinished)
    const finished = allFinished.slice(-SHOWN_FINISHED)

    const finishedRows = finished.map((t) => (
      <Text key={`fin-${t.id}`} dimColor>
        {`✓ #${t.id} ${t.title}${t.answer ? `: ${t.answer}` : ''}`}
      </Text>
    ))

    const clearButton = (
      <Button
        key="clear-completed"
        label={`Clear completed (${allFinished.length})`}
        onPress={() => clearCompleted($)}
      />
    )

    if (open.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nothing for you to do right now.</Text>
          {finishedRows}
          {allFinished.length > 0 && clearButton}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {open.map((t, idx) => (
          <Box key={`task-${t.id}`} flexDirection="column" marginTop={idx > 0 ? 1 : 0}>
            <Text bold>{`#${t.id}  ${t.title}`}</Text>
            {t.steps.map((s, i) => (
              <Box key={`step-${i}`} flexDirection="column">
                {s.text && <Text wrap="wrap">{`${i + 1}. ${s.text}`}</Text>}
                {s.command && <Code source={s.command} language="sh" />}
                {s.command && (
                  <Button
                    key={`copy-${t.id}-${i}`}
                    label="Copy command"
                    onPress={async (press) => {
                      // Selecting wrapped text copies the soft wraps as newlines; this copies the raw command
                      const { isCopied } = await $.ui.copy({ text: s.command, surface: press.surface })
                      $.ui.toast(isCopied ? 'Command copied' : 'Could not copy the command')
                    }}
                  />
                )}
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
        {finished.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            {finishedRows}
            {clearButton}
          </Box>
        )}
      </Box>
    )
  })
}
