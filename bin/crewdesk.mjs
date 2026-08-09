#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../src/server.mjs';

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.findIndex((a) => a === `--${name}` || a === `-${name[0]}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`crewdesk — a local dashboard for Claude Code

Usage: crewdesk [options]

Options:
  --port, -p <number>   Port to listen on (default: 4600)
  --host <string>       Interface to bind (default: 127.0.0.1)
  --help, -h            Show this help

Reads ~/.claude read-only. Writes only to ~/.crewdesk/.
`);
  process.exit(0);
}

// 0.1.0 öncesi veri dizininden taşı
const legacy = path.join(os.homedir(), '.agent-board');
const current = path.join(os.homedir(), '.crewdesk');
if (fs.existsSync(legacy) && !fs.existsSync(current)) {
  try {
    fs.renameSync(legacy, current);
    console.log(`crewdesk: moved existing data ${legacy} → ${current}`);
  } catch {
    /* taşınamazsa temiz başlar */
  }
}

const port = Number(flag('port', 4600));
const host = flag('host', '127.0.0.1');

const { url } = await start({ port, host });
console.log(`crewdesk → ${url}`);
