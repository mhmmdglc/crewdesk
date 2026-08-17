#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// src/sources.mjs, yüklendiği anda os.homedir()'i sabitliyor. Demo modunda HOME'u
// değiştirmemiz gerektiği için sunucu MODÜLÜ statik değil, dinamik yükleniyor —
// aksi halde demo gerçek ~/.claude'u okur.

const args = process.argv.slice(2);

// Demo verisi seed anına sabitlenirse ~90 saniye sonra "hiçbir şey koşmuyor"a
// düşüyor. Ekran, kullanıcı okurken sönmesin diye periyodik tazeleniyor.
const DEMO_REFRESH_MS = 30 * 1000;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

const HELP = `crewdesk — a local dashboard for Claude Code

Usage: crewdesk [demo|install-hook] [options]

Options:
  --port, -p <number>   Port to listen on (default: 4600)
  --host <string>       Interface to bind (default: 127.0.0.1). crewdesk has no
                        authentication, so binding anything but loopback opens
                        your session titles, Claude's last message, absolute
                        transcript paths, project directories and git branches
                        to everyone on the network
  --demo, -d            Serve fabricated data instead of your own
  --help, -h            Show this help

Commands:
  install-hook          Print the Stop hook that delivers nudges, and offer to
                        add it to ~/.claude/settings.json. This is the one
                        thing crewdesk ever writes outside ~/.crewdesk/, it
                        asks first, and it never runs on its own.

Run "crewdesk demo" to serve fabricated data instead of your own.

Reads ~/.claude read-only. Writes only to ~/.crewdesk/.
`;

// Hata yolunda yığın dökümü basmıyoruz: kullanıcıya tek satırlık bir cümle borçluyuz.
function fail(message) {
  process.stderr.write(`crewdesk: ${message}\n`);
  process.exit(1);
}

function parsePort(raw, flagName) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`invalid value for "${flagName}": ${JSON.stringify(raw)} — expected an integer between 1 and 65535`);
  }
  return port;
}

// Elle yazılmış çözümleyici: tanımadığı hiçbir argümanı sessizce yutmaz.
// Eskiden args.includes('demo') tam eşleşme aradığı için "--demo" gerçek veriyi,
// "--prot 4700" da sessizce varsayılan portu açıyordu.
function parseArgs(argv) {
  const options = { demo: false, help: false, installHook: false, port: 4600, host: '127.0.0.1' };

  const valueFor = (flagName, index) => {
    const value = argv[index];
    if (value === undefined || value.startsWith('-')) {
      fail(`option "${flagName}" needs a value — see crewdesk --help`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'demo' || arg === '--demo' || arg === '-d') {
      options.demo = true;
    } else if (arg === 'install-hook') {
      options.installHook = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--port' || arg === '-p') {
      options.port = parsePort(valueFor(arg, ++i), arg);
    } else if (arg === '--host') {
      options.host = valueFor(arg, ++i);
    } else {
      fail(`unknown argument ${JSON.stringify(arg)} — see crewdesk --help`);
    }
  }

  return options;
}

// src/server.mjs'in start()'ı yalnızca dinlemeye başlayınca çözülüyor; bağlanma
// hatası hiçbir yerde yakalanmadığı için yığın dökümüne dönüşüyordu. Adresi önce
// tek kullanımlık bir soketle deneyip hatayı kendi cümlemizle anlatıyoruz.
function probeBind(host, port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) => resolve(error));
    probe.listen(port, host, () => probe.close(() => resolve(null)));
  });
}

function explainBindError(error, host, port) {
  switch (error.code) {
    case 'EADDRINUSE':
      return `port ${port} is already in use — try --port <other>`;
    case 'EACCES':
      return `binding ${host}:${port} needs elevated privileges — try --port <number above 1024>`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'EADDRNOTAVAIL':
      return `cannot bind host ${JSON.stringify(host)} — no local interface has that address`;
    default:
      return `cannot listen on ${host}:${port} — ${error.code || error.message}`;
  }
}

// Loopback dışına bağlanmak crewdesk'i ağa açar; kimlik doğrulaması yok.
function warnIfExposed(host) {
  if (LOOPBACK.has(host.toLowerCase())) return;
  process.stderr.write(
    `crewdesk: WARNING — bound to ${host}, not loopback.\n`
    + 'crewdesk has no authentication. Everyone who can reach this port sees your\n'
    + "session titles, the assistant's last message, absolute transcript paths,\n"
    + 'project directories and git branches. Only do this on a network you trust.\n',
  );
}

const options = parseArgs(args);

if (options.help) {
  console.log(HELP);
  process.exit(0);
}

// Dürtmeyi oturuma taşıyan Stop kancasını kurar. crewdesk'in ~/.crewdesk dışına
// yazdığı TEK yer burası: kullanıcı bu komutu kendi yazar ve onay verir.
if (options.installHook) {
  const hookPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'hooks', 'crewdesk-nudge.mjs');
  const hook = { type: 'command', command: `node ${JSON.stringify(path.resolve(hookPath))}`, timeout: 10 };
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  console.log(`crewdesk nudges are delivered by a Claude Code Stop hook.

crewdesk itself only ever writes to ~/.crewdesk/nudges/. The hook below runs
inside your own Claude Code, reads a waiting nudge for that session, and hands
it to Claude instead of letting the turn end.

This is what would be added to ${settingsPath}:

${JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [hook] }] } }, null, 2)}
`);

  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    current = null;
  }
  const already = JSON.stringify(current?.hooks?.Stop || []).includes('crewdesk-nudge');
  if (already) {
    console.log('Already installed — nothing to do.');
    process.exit(0);
  }
  if (!process.stdin.isTTY) {
    console.log('Not a terminal, so nothing was written. Paste the block above into that file,');
    console.log('or run "crewdesk install-hook" from a terminal to have it added for you.');
    process.exit(0);
  }

  process.stdout.write(`Add it to ${settingsPath}? [y/N] `);
  const answer = await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => resolve(String(chunk).trim().toLowerCase()));
  });
  if (answer !== 'y' && answer !== 'yes') {
    console.log('Nothing written.');
    process.exit(0);
  }

  const next = current && typeof current === 'object' ? current : {};
  next.hooks = next.hooks && typeof next.hooks === 'object' ? next.hooks : {};
  const stop = Array.isArray(next.hooks.Stop) ? next.hooks.Stop : [];
  stop.push({ matcher: '', hooks: [hook] });
  next.hooks.Stop = stop;

  // Var olan ayarları kaybetmemek için önce yedek, sonra atomik değiştirme
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    if (current) fs.copyFileSync(settingsPath, `${settingsPath}.crewdesk-backup`);
    const tmp = `${settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, settingsPath);
  } catch (error) {
    fail(`could not write ${settingsPath} — ${error.code || error.message}`);
  }
  console.log(`Installed.${current ? ` Previous file kept at ${settingsPath}.crewdesk-backup.` : ''}`);
  console.log('Restart any Claude Code session that is already running for it to pick this up.');
  process.exit(0);
}

let demoHome = null;

if (options.demo) {
  // `crewdesk demo`: uydurma bir ~/.claude ağacı kurup onu sunar, gerçek veri okunmaz
  const { seed, DEMO_HOME } = await import('../demo/seed.mjs');
  try {
    seed();
  } catch (error) {
    fail(error.message);
  }
  demoHome = DEMO_HOME;
  process.env.HOME = DEMO_HOME;
  process.env.USERPROFILE = DEMO_HOME;

  const refresh = setInterval(() => {
    try {
      seed({ refresh: true });
    } catch {
      /* tazeleme başarısızsa ekran donar, süreç değil */
    }
  }, DEMO_REFRESH_MS);
  refresh.unref();
} else {
  // 0.1.0 öncesi veri dizininden taşı
  const legacy = path.join(os.homedir(), '.agent-board');
  const current = path.join(os.homedir(), '.crewdesk');
  if (fs.statSync(legacy, { throwIfNoEntry: false })?.isDirectory() && !fs.existsSync(current)) {
    try {
      fs.renameSync(legacy, current);
      console.log(`crewdesk: moved existing data ${legacy} → ${current}`);
    } catch {
      /* taşınamazsa temiz başlar */
    }
  }
}

const bindError = await probeBind(options.host, options.port);
if (bindError) fail(explainBindError(bindError, options.host, options.port));

const { start } = await import('../src/server.mjs');
const { url } = await start({ port: options.port, host: options.host });

warnIfExposed(options.host);

if (demoHome) {
  console.log(`crewdesk demo → ${url}`);
  console.log(`fabricated data in ${demoHome} — your real ~/.claude is not read`);
} else {
  console.log(`crewdesk → ${url}`);
}
