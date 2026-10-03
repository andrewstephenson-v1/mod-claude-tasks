export type TaskStatus = 'open' | 'done' | 'chosen' | 'replied' | 'removed'

export type TaskStep = { text: string; command: string }

export type Task = {
  id: number
  title: string
  steps: TaskStep[]
  expect: string
  options: string[]
  status: TaskStatus
  answer: string
}

export type Board = { tasks: Task[]; nextId: number }

declare module 'claude-code' {
  interface PluginState {
    'human-tasks': {
      board: Board
      /** Id of the task whose reply field is open, if any. */
      replyingId: number | null
    }
  }
}
