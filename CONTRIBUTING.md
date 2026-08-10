# Contributing to crewdesk

Thanks for looking. crewdesk is small on purpose: no build step, no runtime dependencies, no framework. Please keep it that way.

## Running it

```bash
git clone https://github.com/mhmmdglc/crewdesk.git
cd crewdesk
node bin/crewdesk.mjs --port 4601
```

Port 4601 rather than the default 4600 so you can keep a stable copy running while you hack.

There is no watcher: restart the process after changing anything under `src/`. Changes under `public/` only need a browser reload.

## Checks before a pull request

```bash
npm run check
```

That parses every `.js`/`.mjs` file in the repository with `node --check` and names the ones that fail. Do not replace it with a single `node --check` call over a glob: `node --check` only reads its first argument, so a glob reports success while the second file is broken.

It is also the whole test suite today, which is an honest way of saying there isn't one. If you add logic to `src/events.mjs` or `src/sources.mjs`, a small script under `test/` that exercises it with fixture files would be very welcome.

## Layout

| File | Responsibility |
|---|---|
| `bin/crewdesk.mjs` | CLI argument parsing, starts the server |
| `src/server.mjs` | HTTP routes, static file serving, state assembly |
| `src/sources.mjs` | Everything that reads `~/.claude`. The only file that knows Claude Code's on-disk format |
| `src/events.mjs` | The handoff log and the rules that derive rooms from it |
| `src/board.mjs` | Stage/owner overlay persistence |
| `public/index.html` | UI shell, project sidebar, board, alerts |
| `public/office.js` | Canvas renderer for the pixel office |

If you want to support another agent CLI, `src/sources.mjs` is the file to change; nothing else should need to know where the data came from.

## Design rules

These are the opinions the project is built on. Please argue with them in an issue before breaking them in a PR.

1. **Read-only against Claude Code.** crewdesk must never write to `~/.claude`. Our own state lives in `~/.crewdesk/`.
2. **Derive, don't store.** A room, a queue length, a test-round count are all consequences of the handoff log. Adding a field that has to be kept in sync by hand is how dashboards start lying.
3. **The screen must tell the truth.** If nothing is running, the work room is empty. Never render activity we did not observe.
4. **No dependencies at runtime.** Node's standard library is enough for a local dashboard. Dev tooling is negotiable; `dependencies` is not.
5. **No telemetry, no outbound calls.** Not even version checks.

## Assets

Sprites come from third parties under CC0 and MIT — see [LICENSE-THIRD-PARTY.md](LICENSE-THIRD-PARTY.md). If you add art, add its provenance and licence to that file in the same commit. Do not add assets whose licence you cannot name.

## Commit messages

Plain, imperative, and about the behaviour rather than the file: `fix: stop the alert panel from redrawing itself`. Reference an issue when there is one.

## Reporting bugs

Include your OS, Node version, how you started it, and — if it is about what the screen shows — what you expected versus what appeared. `curl -s localhost:4600/api/state | head -c 2000` in the report saves a round trip.
