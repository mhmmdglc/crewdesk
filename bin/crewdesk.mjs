#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// src/sources.mjs, yüklendiği anda os.homedir()'i sabitliyor. Demo modunda HOME'u
// değiştirmemiz gerektiği için sunucu MODÜLÜ statik değil, dinamik yükleniyor —
// aksi halde demo gerçek ~/.claude'u okur.

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.findIndex((a) => a === `--${name}` || a === `-${name[0]}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`crewdesk — a local dashboard for Claude Code

Usage: crewdesk [demo] [options]

Options:
  --port, -p <number>   Port to listen on (default: 4600)
  --host <string>       Interface to bind (default: 127.0.0.1)
  --help, -h            Show this help

Run "crewdesk demo" to serve fabricated data instead of your own.

Reads ~/.claude read-only. Writes only to ~/.crewdesk/.
`);
  process.exit(0);
}

// `crewdesk demo`: uydurma bir ~/.claude ağacı kurup onu sunar, gerçek veri okunmaz
if (args.includes('demo')) {
  const { seed, DEMO_HOME } = await import('../demo/seed.mjs');
  seed();
  process.env.HOME = DEMO_HOME;
  process.env.USERPROFILE = DEMO_HOME;
  const { start: startDemo } = await import('../src/server.mjs');
  const demoPort = Number(flag('port', 4600));
  const { url: demoUrl } = await startDemo({ port: demoPort, host: flag('host', '127.0.0.1') });
  console.log(`crewdesk demo → ${demoUrl}`);
  console.log(`fabricated data in ${DEMO_HOME} — your real ~/.claude is not read`);
} else {

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

const { start } = await import('../src/server.mjs');
const { url } = await start({ port, host });
console.log(`crewdesk → ${url}`);
}
