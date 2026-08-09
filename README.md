# agent-board

A local dashboard for [Claude Code](https://claude.com/claude-code): every project, every agent, what stage the work is in — and how much of your token window you have burned.

Built for the moment you have Claude Code running in four repos at once and you have lost track of which one is waiting on you, which one is in test, and which one bounced back from test for the second time.

> Status: **v0.1** — working, unpolished, and read-only against Claude Code's own local files. No account, no API key, no telemetry, nothing leaves your machine.

## What it shows

**Left — projects.** Every project Claude Code has touched in the last 7 days, with a live status dot (running / waiting for you / idle) and the number of open work items.

**Top — token windows.** Rolling **5-hour** and **7-day** token consumption, computed from Claude Code's own hourly buckets. When Claude Code publishes official limit gauges, they are rendered as progress bars next to the raw numbers.

**Center, top — the project's crew.** Each project has its own agent roster (`<project>/.claude/agents/*.md`) — agent-board reads it, so kordinat shows `be-specialist / payment-specialist / qa-reviewer…` while another repo shows `backend-dev / ux-designer / release-manager…`. Active agents glow and carry a speech bubble with the tool they are running. Projects without a roster fall back to showing live sessions.

**Center, top — live sessions.** Each session in the selected project: its title, git branch, the tool it is running right now, how long since it moved, its 5-hour token spend, and any sub-agents it spawned.

**Ofis view — the crew at work.** Characters are *agents*, not tasks. Rooms are what each agent is doing right now: **PM odası** (the orchestrator), **Çalışma odası**, **Test odası**, **Teslim odası** (finished work waiting to be picked up), **Bekleme odası** (blocked on your permission) and **Dinlenme odası** (empty queue). The label above an agent's head is the task in hand, the badge on their shoulder is their queue length. Nothing about position is stored — it is derived from the handoff log, so the office, the board and the stats all read from one source.

**Center — the stage board.** Work items in four columns: **Manager → Geliştirme (dev) → Test → Bitti (done)**. Move a card by clicking a stage. Moving a card *backwards out of Test* increments its test-round counter, so a card that has bounced twice says so on its face.

## Install & run

Requires Node.js 20+ and Claude Code installed.

```bash
npx agent-board
```

Or from a clone:

```bash
git clone https://github.com/<you>/agent-board.git
cd agent-board
node bin/agent-board.mjs --port 4600
```

Then open http://127.0.0.1:4600. Bound to loopback by default.

```
Options:
  --port, -p <number>   Port to listen on (default: 4600)
  --host <string>       Host to bind to (default: 127.0.0.1)
```

## Where the data comes from

Everything is read from Claude Code's local state. agent-board never writes to it.

| Source | Used for |
|---|---|
| `~/.claude/projects/<project>/*.jsonl` | projects, sessions, git branch, current tool, sub-agents, activity age |
| `~/.claude/tasks/<sessionId>/*.json` | work items (id, subject, status) |
| `~/.claude/session-monitor/token-buckets.json` | hourly token buckets → 5-hour and 7-day windows, per session attribution |
| `~/.claude/session-monitor/official-usage.json` | official limit gauges, when Claude Code has populated them |
| `<project>/.claude/agents/*.md` | the project's own agent roster: name, colour, role |

agent-board writes two files of its own. `~/.agent-board/events.jsonl` is the handoff log — one append-only line per `assigned` / `started` / `delivered` / `returned` / `done`, from which queues, rooms, test rounds and cycle times are all derived. The other is the stage overlay: `~/.agent-board/overlay.json`, keyed by `sessionId:taskId`, holding stage, owner, test-round count and a short history. Delete that file and you are back to derived stages.

Transcripts are read from the tail only (last 256 KB per session), so multi-hundred-megabyte session files cost nothing.

## Why an overlay instead of writing back to Claude Code

Claude Code tasks have three states: `pending`, `in_progress`, `completed`. A delivery pipeline has more: something can be *done by the developer but sitting in test*, or *back from test for the second time*. Rather than overload the native status field, agent-board keeps that process state beside it. Native status still drives the default column, so a board with no overlay is still correct on day one.

## Roadmap

- [ ] i18n — the UI ships Turkish today; strings need extracting
- [x] Assign an owner agent per card from the UI
- [ ] Infer assignment automatically from `Agent` tool calls and `SubagentStop`
- [x] Pixel office view (rooms = stages, characters = work items)
- [ ] Drag and drop between columns
- [x] Per-project agent roster read from `.claude/agents`
- [ ] Per-project stage configuration (not every team has the same four stages)
- [ ] Desktop notification when a session flips to *waiting for input*
- [ ] Cost estimate per project from token buckets
- [ ] Optional hook mode for sub-second updates instead of 4s polling
- [ ] Support other agent CLIs that keep local transcripts

## API

- `GET /api/state` — the whole board as JSON
- `POST /api/stage` — `{ "key": "<sessionId>:<taskId>", "stage": "manager|dev|test|done", "owner": "optional" }`
- `GET /api/health`

## Credits

Character sprites are from **MetroCity — Free Topdown Character Pack** by [JIK-A-4](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack), released under **CC0 1.0** (public domain). Attribution is not required by the licence; it is here because the pack is good. Furniture, rooms and everything else are drawn procedurally in `public/office.js`.

## License

MIT
