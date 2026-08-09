#!/usr/bin/env node
import { start } from '../src/server.mjs';

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.findIndex((a) => a === `--${name}` || a === `-${name[0]}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: agent-board [options]

Options:
  --port, -p <number>   Port to listen on (default: 4600)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --help, -h            Show this help
`);
  process.exit(0);
}

const port = Number(flag('port', 4600));
const host = flag('host', '127.0.0.1');

const { url } = await start({ port, host });
console.log(`agent-board → ${url}`);
