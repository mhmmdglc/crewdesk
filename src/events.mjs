import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './board.mjs';

const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');

// Devir teslim kütüğü: pozisyonu değil, olayı saklarız. Oda, kuyruk, test turu,
// darboğaz — hepsi bu kütükten türetilir.
export const EVENTS = ['assigned', 'started', 'delivered', 'returned', 'done'];

export const ROOMS = ['pm', 'work', 'test', 'handoff', 'waiting', 'lounge'];

export const ROOM_LABEL = {
  pm: 'PM ODASI',
  work: 'ÇALIŞMA ODASI',
  test: 'TEST ODASI',
  handoff: 'TESLİM ODASI',
  waiting: 'BEKLEME ODASI',
  lounge: 'DİNLENME ODASI',
};

let cache = null;

export async function readEvents() {
  if (cache) return cache;
  const raw = await fsp.readFile(LOG_FILE, 'utf8').catch(() => '');
  cache = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return cache;
}

export async function appendEvent(event) {
  if (!EVENTS.includes(event.event)) throw new Error(`unknown event: ${event.event}`);
  const record = { ts: Date.now(), ...event };
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.appendFile(LOG_FILE, JSON.stringify(record) + '\n');
  cache = [...(cache || []), record];
  return record;
}

function isQaRole(name = '') {
  return /qa|test/i.test(name);
}

function isPmRole(name = '') {
  return /manager|pm\b/i.test(name);
}

/**
 * Ajanların o anki odasını ve yükünü olay kütüğünden + canlı aktiviteden türetir.
 * Kural sırası önemli: bekleme > teslim (taze) > çalışma/test > PM > dinlenme.
 */
export function deriveCrew({ roster, tasks, events, activeNames, waitingNames }) {
  const HANDOFF_LINGER = 3 * 60 * 1000;
  const byTask = new Map();

  for (const event of events) {
    if (!event.taskKey) continue;
    byTask.set(event.taskKey, event);
  }

  const assignments = new Map(); // agent -> tasks
  for (const task of tasks) {
    const last = byTask.get(task.key);
    const owner = task.owner || (last && last.event !== 'done' ? last.to : null);
    if (!owner) continue;
    if (!assignments.has(owner)) assignments.set(owner, []);
    assignments.get(owner).push({ ...task, lastEvent: last || null });
  }

  return roster.map((agent) => {
    const queue = (assignments.get(agent.name) || []).filter((t) => t.stage !== 'done');
    const active = activeNames.has(agent.name);
    const waiting = waitingNames.has(agent.name);
    const recentHandoff = events
      .filter((e) => e.from === agent.name && e.event === 'delivered')
      .some((e) => Date.now() - e.ts < HANDOFF_LINGER);

    let room;
    if (waiting) room = 'waiting';
    else if (recentHandoff) room = 'handoff';
    else if (isPmRole(agent.name)) room = 'pm';
    else if (queue.length === 0) room = 'lounge';
    else if (isQaRole(agent.name)) room = 'test';
    else room = 'work';

    const current = queue.find((t) => t.status === 'in_progress') || queue[0] || null;

    return {
      ...agent,
      room,
      active,
      waiting,
      queue: queue.length,
      currentTask: current ? { id: current.id, subject: current.subject, key: current.key } : null,
      testRounds: queue.reduce((max, t) => Math.max(max, t.testRounds || 0), 0),
    };
  });
}
