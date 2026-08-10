# crewdesk — full guide

Everything the [README](../README.md) leaves out. Nothing here is required to use crewdesk; it is required to trust it.

- [Running it](#running-it)
- [The board](#the-board)
- [The office](#the-office)
- [Token windows](#token-windows)
- [Question alerts](#question-alerts)
- [Defining agents](#defining-agents)
- [Where the data comes from](#where-the-data-comes-from)
- [The handoff log](#the-handoff-log)
- [HTTP API](#http-api)
- [Privacy](#privacy)
- [FAQ](#faq)
- [Roadmap](#roadmap)

## Running it

```bash
npx github:mhmmdglc/crewdesk                 # http://127.0.0.1:4600
npx github:mhmmdglc/crewdesk --port 4700     # somewhere else
npx github:mhmmdglc/crewdesk demo            # fabricated data, your own is never read
```

crewdesk is installed straight from the repository — there is no npm package to
publish or trust, and `npx` caches the clone so later runs are instant.

`demo` builds a throwaway tree under your temp directory (override it with
`CREWDESK_DEMO_HOME`, which crewdesk refuses to erase unless the directory is
empty or already its own) and keeps rewriting it while it runs, so the office
does not fall quiet while you are still reading it.

| Flag | Default | Meaning |
|---|---|---|
| `--port`, `-p` | `4600` | Port to listen on |
| `--host` | `127.0.0.1` | Interface to bind. crewdesk has no authentication, so anything but loopback opens your session titles, the assistant's last message, absolute transcript paths, project directories and git branches to everyone on the network. It prints a warning when you do it — read [Privacy](#privacy) first |
| `--demo`, `-d` | | Serve fabricated data instead of your own (same as the `demo` argument) |
| `--help`, `-h` | | Print usage |

Anything else is refused: crewdesk exits with a message rather than silently ignoring an argument it does not know, so a typo like `--prot 4700` cannot quietly leave you on the default port.

Global install if you would rather have the command around:

```bash
npm install --global github:mhmmdglc/crewdesk
crewdesk
```

From source:

```bash
git clone https://github.com/mhmmdglc/crewdesk.git
cd crewdesk
node bin/crewdesk.mjs
```

The interface ships in English, Turkish, Spanish, Simplified Chinese, Japanese and German. It picks your browser's language on first run; the selector in the header overrides it and the choice is remembered.

## The board

Four columns — **Manager → Dev → Test → Done**.

Cards come from Claude Code's own task list (`~/.claude/tasks/`). Their starting column is derived from the native status: `pending` lands in Manager, `in_progress` in Dev, `completed` in Done. Move a card and crewdesk remembers your choice instead.

**Owner** — the dropdown on each card assigns it to one of that project's agents. This is what fills the queue badges in the office.

**Test rounds** — moving a card *backwards out of Test* increments a counter, and the card starts showing `↺2`, `↺3`. It answers a question a plain kanban cannot: is this thing converging, or has it bounced three times?

## The office

The same state, drawn as rooms. **Characters are agents, not tasks**, and the room means what the agent is doing right now.

| Room | Who is in it |
|---|---|
| **PM office** | The orchestrating session, and any agent whose name reads as a manager role |
| **Work room** | Agents that are *running right now* — the monitor animates while they work |
| **Test room** | The same, for QA-shaped roles (`qa`, `test`, `tester`, `reviewer`) |
| **Handoff** | Agents that delivered something in the last few minutes |
| **Waiting room** | Sessions blocked on **you** — an answer, a permission, a decision |
| **Lounge** | Idle agents. A backlog is not work: an agent with a queue but no running process waits here |

On each character: the label above its head is the task in hand, the purple number on its shoulder is how many items are in its queue, the coloured stripe under its name is its role colour, and `↺2` means the work it is holding is on its second test round. Hover for the full task title.

**The rooms tell the truth.** An empty work room means nothing is running, even if ten items are assigned to five agents. A dashboard that flatters you is worse than no dashboard, so assignment is never drawn as activity.

Role detection matches whole labels, not substrings — `protest-writer` does not land in the test room.

## Token windows

Rolling **5-hour** and **7-day** consumption, summed from Claude Code's own hourly buckets in `~/.claude/session-monitor/token-buckets.json`, and attributed per session so each session card shows its share.

When Claude Code publishes official limit gauges (`official-usage.json`), they render as progress bars beside the raw numbers. Until then crewdesk shows what you have spent, not what you have left — it will not invent a denominator it cannot see.

The 5-hour window is a sum over the last five hourly buckets, so immediately after the hour turns it covers a little over four hours of real time.

## Question alerts

When a chat is waiting on you, crewdesk raises a card in the corner and, if you allow it, a desktop notification.

It separates two things that look identical in a transcript:

- **A question** — the last turn ends in a question mark or an asking pattern. This interrupts you.
- **A finished turn** — Claude simply stopped and it is your move. This is counted quietly, never raised.

Only questions from chats touched in the last two hours are raised; an eight-hour-old chat is not waiting for you, it has just stopped.

Two windows are at work and they are not the same. The alert panel uses two hours, because a question older than that has usually been overtaken. The office and the sidebar use eight hours, because an agent that worked this morning still belongs on the floor even if it has gone quiet.

Dismiss one with `×`, clear the lot with **mark all read**, or collapse the stack to a bell. Read marks are keyed to the chat's last message, so a *new* question from the same chat alerts again.

Detection is heuristic. False positives happen; dismiss them. Hooking Claude Code's `Notification` event will make it exact and is on the roadmap.

## Defining agents

Each project's crew comes from its own `.claude/agents/*.md` files. A file looks like this:

```markdown
---
name: backend-dev
description: Endpoints, migrations, background jobs. Use for anything server-side.
color: blue
---

You own the server side of this project. Read the schema before changing a query.
Write a migration for every schema change and never edit one that has shipped.
```

| Field | Used for |
|---|---|
| `name` | The character's label. Suffixes like `-specialist` are trimmed on screen |
| `description` | How Claude Code decides when to use the agent; shown on hover in crewdesk |
| `color` | The stripe under the character — `blue`, `green`, `purple`, `orange`, `red`, `cyan`, `yellow`, `pink` |

The fastest way to make one is to ask Claude Code for it in plain language: *"create a `release-manager` agent for this repo that only cuts releases and writes changelogs."* It writes the file to the right place.

Projects differ, and crewdesk shows each one's own crew: a web app might have `frontend-dev / backend-dev / qa-tester`, a docs repo just `docs-writer`. A project with no agent files shows the session itself as the single person working.

## Where the data comes from

Everything is read from Claude Code's local state. crewdesk never writes to it.

| Source | Used for |
|---|---|
| `~/.claude/projects/<project>/*.jsonl` | projects, sessions, git branch, current tool, activity age, waiting-for-you detection |
| `~/.claude/projects/<project>/<session>/subagents/*.jsonl` | which agent is running right now, and what it is doing |
| `~/.claude/tasks/<sessionId>/*.json` | work items — id, subject, status |
| `~/.claude/session-monitor/token-buckets.json` | hourly token buckets → the 5-hour and 7-day windows |
| `~/.claude/session-monitor/official-usage.json` | official limit gauges, when populated |
| `<project>/.claude/agents/*.md` | that project's crew: name, colour, role |

Transcripts are read from the tail only — the last 256 KB per session, widened when a single line is bigger than that. A 140 MB session file costs nothing.

A sub-agent's liveness comes from its *own* file, not the parent transcript: the parent goes silent while a sub-agent runs, so watching it would make every agent that takes longer than ninety seconds invisible.

## The handoff log

crewdesk writes two files, both under `~/.crewdesk/`:

**`events.jsonl`** — append-only, one line per handoff:

```json
{"ts":1786292100000,"taskKey":"<sessionId>:3","from":"backend-dev","to":"qa-tester","event":"delivered"}
```

Queues, rooms, test rounds and cycle times are all *derived* from this log, never stored. Position is a consequence of history rather than a field somebody forgot to update. Events are `assigned`, `started`, `delivered`, `returned`, `done`.

**`overlay.json`** — stage and owner per task, keyed by `sessionId:taskId`.

Delete either file and you are back to state derived purely from Claude Code's own data.

### Why an overlay instead of writing back to Claude Code

Claude Code tasks have three states: `pending`, `in_progress`, `completed`. A delivery pipeline has more — something can be done by the developer but sitting in test, or back from test for the second time. Rather than overload the native status field, or worse, mutate Claude Code's files, crewdesk keeps process state beside it. Native status still drives the default column, so a fresh install is already correct.

## HTTP API

crewdesk is a plain HTTP server; the UI is its first client.

```http
GET  /api/state     # the whole board as JSON
GET  /api/events    # the raw handoff log
GET  /api/health
POST /api/stage     # { "key": "<sessionId>:<taskId>", "stage": "manager|dev|test|done" }
POST /api/assign    # { "key": "...", "agent": "qa-tester", "event": "assigned" }
```

Assign a task from a script or a hook:

```bash
curl -X POST http://127.0.0.1:4600/api/assign \
  -H 'content-type: application/json' \
  -d '{"key":"<sessionId>:3","agent":"qa-tester","event":"delivered"}'
```

POSTs require a same-origin request and a JSON content type, and every key is validated — a local server with no authentication should not be usable by any web page you happen to have open.

## Privacy

- Binds to `127.0.0.1`, and **has no authentication of any kind**. `--host 0.0.0.0` — or any other non-loopback address — hands everyone who can reach the port your session titles, the assistant's last message, task subjects, absolute transcript paths, project directories and git branches. crewdesk prints a warning on stderr when it starts that way; only do it on a network you trust.
- Reads `~/.claude` **read-only**. It never modifies Claude Code's files.
- Writes only to `~/.crewdesk/`.
- No analytics, no crash reporting, no update checks, no outbound requests at all, zero runtime dependencies.
- The page is served with a strict Content-Security-Policy and every value rendered from your data is escaped.

## FAQ

**Does this send my code or prompts anywhere?**
No. There is no outbound network call in the process.

**Do I need to configure my projects?**
No. Anything Claude Code has touched in the last seven days shows up automatically.

**Why is my work room empty when I have tasks assigned?**
Because nothing is running. Assignment is not execution — idle agents wait in the lounge with their queue on their shoulder.

**Why does an agent disappear between tasks?**
Claude Code sub-agents are ephemeral; they exist only while running. crewdesk draws *roles* from your agent files, so the character stays and simply stops glowing.

**It says a chat is waiting for me, but it isn't.**
Question detection is heuristic. Dismiss it with `×`.

**Can I use it with something other than Claude Code?**
Not yet. The reader is isolated in `src/sources.mjs`; any tool that keeps local JSONL transcripts could be added there.

**Does it work on Windows and Linux?**
It only assumes `~/.claude` and Node 20+. Developed on macOS; reports from elsewhere welcome.

**Can I run two copies at once?**
Yes. Writes are queued and land atomically, and each instance revalidates against the file on disk, so two copies will not clobber each other.

## Roadmap

- [ ] Infer assignment automatically from `Agent` tool calls and `SubagentStop`
- [ ] Drag and drop between columns
- [ ] Per-project stage configuration — not every team has the same four stages
- [ ] Cycle time and bottleneck stats from the handoff log
- [ ] Cost estimate per project from token buckets
- [ ] Hook mode for sub-second updates instead of 4s polling
- [ ] Support other agent CLIs that keep local transcripts
