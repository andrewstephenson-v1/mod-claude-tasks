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

/** Whether Claude uses the pane on its own: `unset` until the user answers the onboarding card. */
export type Mode = 'unset' | 'auto' | 'manual'

/** The pane's two views. */
export type Tab = 'open' | 'completed'

export type Board = { tasks: Task[]; nextId: number }

declare module 'claude-code' {
  interface PluginState {
    'human-tasks': {
      board: Board
      /** Id of the task whose reply field is open, if any. */
      replyingId: number | null
      mode: Mode
      /** True once the board has been restored from the store. */
      loaded: boolean
      tab: Tab
      /** Ids of completed tasks shown expanded. */
      expandedIds: number[]
    }
  }
}
