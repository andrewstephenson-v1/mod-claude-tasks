# human-tasks

A Claude Code mod that keeps the manual steps Claude asks you to perform in a persistent pane, instead of letting them scroll away in the chat.

Claude posts a task (title, steps or shell commands, what to expect, optional outcomes). Each open task stays visible until you:

- press **Done**,
- pick one of its **outcomes**, or
- **Reply** with free text (for example pasted output).

The mod then starts a turn telling Claude what you did.

## Automatic use

The first time you open the pane (`/human-tasks`) it asks whether Claude should use it on its own. Choosing **Yes, automatically** adds a short section to the system prompt so Claude posts anything only you can do, and checks tasks off when you confirm them in chat or paste output that clearly shows success. **Only when I ask** leaves the tool available without that nudge. The **Auto** button at the bottom of the pane flips the choice later; it is stored once for you, not per project.

## Usage

- `/human-tasks` opens the pane, with **Open** and **Completed** tabs. Open tasks arrive folded to their title line; press a title to expand that task and again to fold it. Finished tasks move to Completed, where **Clear completed** lives and each task expands when you press its title. A line separates tasks.
- A task with more than one step is shown one step at a time: a progress row, the current step with its command, what to expect and when to stop, then **Looks right, next** and **Back**. Each task remembers its own step, and its folded title shows it (for example `step 4 of 8, Inputs`), so you can leave a task halfway, work on another and come back. Moving between steps does not message Claude; Done, an outcome or a Reply does, and says which step you were on.
- Claude uses one tool, `mcp__human-tasks__task`, with `action` of `post` (default), `remove`, `complete` or `list`. `complete` with a `step` checks off one step and leaves the task open. `list` stays short: open tasks plus the five most recent finished ones, with answers cut to a line; `all: true` lists every finished task and `id` shows one task in full. The mod registers it itself; there is no separate MCP server.
- Tasks are stored per project (keyed by the session's project root) and survive restarts. Removed tasks are dropped and only the 50 most recent finished tasks are kept.

## Install

```sh
claude plugin marketplace add andrewstephenson-v1/mod-claude-tasks
claude plugin install human-tasks@human-tasks --scope user
```

The repo is private, so the machine needs git access to it (for example `gh auth login` as `andrewstephenson-v1`).
To try a local clone for one session instead: `claude --plugin-dir /path/to/mod-claude-tasks`.

## Develop

```sh
claude plugin validate .   # manifest and hooks
claude plugin test .       # tests/
npx -p typescript tsc -p . # type-check (needs the engine-generated .claude-plugin/types/)
```

`.claude-plugin/types/` is written by Claude Code when the mod first loads and is not committed.

## Layout

- `hooks/register.tsx`: the hooks module
- `types/index.d.ts`: task types and the `$.state` contract
- `tests/`: `claude plugin test` suite

## License

MIT, see [LICENSE](LICENSE).
