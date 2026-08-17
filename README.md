<h1 align="center">crewdesk</h1>

<p align="center">
  <b>A local dashboard for Claude Code — every project, every agent, what stage the work is in, and how much of your token window is left.</b>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-green">
  <img alt="runtime dependencies" src="https://img.shields.io/badge/runtime%20deps-0-brightgreen">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mhmmdglc/crewdesk/main/docs/office.gif" alt="crewdesk pixel office: agents move between the PM office, work room, test room, handoff, waiting room and lounge" width="880">
</p>

Run Claude Code in four repos at once and you lose the thread: one chat is waiting on an answer you never saw, another burned half your weekly tokens, a third finished twenty minutes ago. crewdesk reads Claude Code's own local files and puts all of it on one screen.

No account, no API key, nothing leaves your machine.

## Install

Node.js 20+, git, and [Claude Code](https://claude.com/claude-code).

```bash
npx github:mhmmdglc/crewdesk
```

Open **http://127.0.0.1:4600**. No config, no setup.

It binds to loopback and has no authentication. `--host 0.0.0.0` opens your session titles, the assistant's last message, absolute transcript paths, project directories and git branches to everyone on the network — crewdesk warns you when you do it, and you should only do it on a network you trust.

Just want to look around first?

```bash
npx github:mhmmdglc/crewdesk demo
```

That serves invented projects from a throwaway directory and never reads your real data. Every image here is that demo.

## Use it

**Board** — your work in four columns: Manager → Dev → Test → Done. Click a stage to move a card, pick an owner from the dropdown. Send a card back out of Test and it starts wearing a `↺2` badge, so you can see what keeps bouncing.

**Office** — the same thing as a room you can glance at. Each character is an agent, and the room it stands in is what it is doing *right now*: working, testing, waiting on you, or idle in the lounge with its queue on its shoulder.

**Nudge** — a session card has a question box. Ask a session what it is doing, and if it is
stuck, tell it to carry on. crewdesk does not reach into a running session; it queues the
nudge and a Claude Code Stop hook delivers it when that session would otherwise stop. Set it
up once with `crewdesk install-hook`.

**Top bar** — rolling 5-hour and 7-day token consumption.

<img src="https://raw.githubusercontent.com/mhmmdglc/crewdesk/main/docs/board.png" alt="crewdesk board: projects sidebar, Manager/Dev/Test/Done columns, token windows and a question alert" width="100%">

## Give a project a crew

crewdesk shows the agents *you* have defined for a project. Claude Code keeps them as markdown files in `.claude/agents/` — one file per agent, a small YAML header and instructions below it.

Ask Claude Code to make one:

> Create a `qa-tester` agent for this project that runs regression scenarios and never edits code.

Or write it yourself — `.claude/agents/qa-tester.md`:

```markdown
---
name: qa-tester
description: Runs regression scenarios and decides whether a change is safe to ship. Does not edit code.
color: yellow
---

You test this project. Write the scenarios first, then run them.
Report findings as PASS / FAIL with steps to reproduce. Never change code —
hand fixes to the developer agents.
```

`name` becomes the character's label, `color` becomes the stripe under it, and `description` is what Claude Code uses to pick the agent. That is the whole contract — save the file and crewdesk shows the agent on the next refresh.

A project with no agent files still works: crewdesk draws the session itself as the one person doing the work.

## Documentation

[**Full guide**](https://github.com/mhmmdglc/crewdesk/blob/main/docs/GUIDE.md) — what every room means, which files are read, the HTTP API, privacy, FAQ.
[Contributing](https://github.com/mhmmdglc/crewdesk/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/mhmmdglc/crewdesk/blob/main/CHANGELOG.md)

## Credits

Character sprites: [MetroCity pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) by JIK-A-4 (CC0).
Furniture sprites: [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by Pablo De Lucca (MIT) — see [LICENSE-THIRD-PARTY.md](https://github.com/mhmmdglc/crewdesk/blob/main/LICENSE-THIRD-PARTY.md).

## License

[MIT](https://github.com/mhmmdglc/crewdesk/blob/main/LICENSE)
