# Changelog

All notable changes to crewdesk are recorded here.

## [0.1.0] — unreleased

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

### Install

Distributed from the repository rather than the npm registry:
`npx github:mhmmdglc/crewdesk`.

### Notes

- Read-only against `~/.claude`; the only files crewdesk writes are under `~/.crewdesk/`.
- Zero runtime dependencies, Node 20+.
