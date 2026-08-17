# Changelog

All notable changes to crewdesk are recorded here.

## [Unreleased]

### Added

- **Nudging a session.** A session card now carries a question box: type something, press
  nudge, and it is queued for that session. crewdesk does not send it — it writes the nudge
  to `~/.crewdesk/nudges/`, and a Claude Code Stop hook hands it to Claude instead of letting
  the turn end. So a session that would have gone quiet carries on instead.

  Install the hook with `crewdesk install-hook`. It prints what it will add, asks before
  touching `~/.claude/settings.json`, keeps a backup, and is the only thing crewdesk ever
  writes outside its own directory.

  A nudge reaches a session at its next stop. A session that has already stopped will not
  pick one up until it runs again — the card says so rather than implying otherwise.

## [0.1.0] — 2026-08-10

First public release.

### Added

- **Project sidebar** — every project Claude Code touched in the last 7 days, with live status, open work count and pending questions.
- **Board** — work items across Manager / Dev / Test / Done, with per-card owner assignment and a test-round counter that increments when a card comes back out of Test.
- **Office** — a pixel-art view where characters are agents and rooms are what each is doing right now: PM office, work room, test room, handoff room, waiting room, lounge. Rooms follow observed activity, so an agent with a queue but no running process waits in the lounge rather than pretending to work.
- **Per-project crew** — agent rosters read from each project's own `.claude/agents/*.md`, including role colours. Projects without definitions show the session itself as the single person working.
- **Token windows** — rolling 5-hour and 7-day consumption from Claude Code's hourly buckets, attributed per session, with official limit gauges rendered when available.
- **Question alerts** — distinguishes a real question from a finished turn; dismissable per card, markable all-read, collapsible to a bell, all persisted.
- **Handoff log** — an append-only `~/.crewdesk/events.jsonl` from which queues, rooms and test rounds are derived rather than stored.
- **HTTP API** — `/api/state`, `/api/events`, `/api/stage`, `/api/assign`, `/api/health`.

### Fixed

- **CLI arguments are parsed, not guessed.** `--demo` and `-d` now start demo mode instead of silently serving your real data, and any argument crewdesk does not recognise — `--prot 4700`, `--frobnicate` — exits with a message rather than being swallowed.
- **Bad ports and unreachable hosts fail with a sentence, not a stack trace.** `--port` must be an integer between 1 and 65535, and an address already in use, refused by the OS or belonging to no local interface is reported in one line.
- **A non-loopback `--host` prints a warning.** crewdesk has no authentication, so binding to the network is now stated as what it is.
- **Demo data stays alive while you read it.** It was frozen at seed time and went quiet after ninety seconds; it is now refreshed periodically. `crewdesk demo` also refuses to erase a `CREWDESK_DEMO_HOME` directory that is not its own.
- **`npm run check` checks every file.** `node --check` only reads its first argument, so the old multi-file invocation passed while later files were broken.

### Install

Distributed from the repository rather than the npm registry:
`npx github:mhmmdglc/crewdesk`.

### Notes

- Read-only against `~/.claude`; the only files crewdesk writes are under `~/.crewdesk/`.
- Zero runtime dependencies, Node 20+.
