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

- `/human-tasks` opens the pane, with **Open** and **Completed** tabs. Finished tasks move to Completed, where **Clear completed** lives. A line separates tasks.
- Claude uses one tool, `mcp__human-tasks__task`, with `action` of `post` (default), `remove`, `complete` or `list`. The mod registers it itself; there is no separate MCP server.
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
