export type TaskStatus = 'open' | 'done' | 'chosen' | 'replied' | 'removed'

export type TaskStep = {
  text: string
  command: string
  /** Short label shown in the progress row and title line, e.g. "Build". */
  name?: string
  /** What the user should see if this step worked. */
  expect?: string
  /** What means stop here and tell Claude. */
  stop?: string
}

export type Task = {
  id: number
  title: string
  steps: TaskStep[]
  expect: string
  options: string[]
  status: TaskStatus
  answer: string
  /** Indexes of the steps the user has marked done; missing on tasks saved before step progress. */
  stepsDone?: number[]
  /** Step the user is looking at, when they moved off the first unfinished one with Back. */
  current?: number
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
      /** Id of the task whose step "Paste output" field is open, if any. */
      pastingId: number | null
      mode: Mode
      /** True once the board has been restored from the store. */
      loaded: boolean
      tab: Tab
      /** Ids of completed tasks shown expanded. */
      expandedIds: number[]
      /** Ids of open tasks shown expanded; the rest show only their title line. */
      openExpandedIds: number[]
    }
  }
}
