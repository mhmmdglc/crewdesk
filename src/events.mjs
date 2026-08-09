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
let cacheMtime = 0;

export async function readEvents() {
  // dosya dışarıdan büyüdüyse (ikinci örnek, elle ekleme) yeniden oku
  const stat = await fsp.stat(LOG_FILE).catch(() => null);
  const mtime = stat?.mtimeMs || 0;
  if (cache && mtime === cacheMtime) return cache;
  cacheMtime = mtime;
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
  const stat = await fsp.stat(LOG_FILE).catch(() => null);
  cacheMtime = stat?.mtimeMs || 0;
  return record;
}

// Rol tespiti alt-dize değil, tam etiket eşleşmesiyle: "protest-writer" ya da
// "latest-news-agent" test odasına düşmemeli.
const labelsOf = (name = '') => String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function isQaRole(name) {
  const labels = labelsOf(name);
  return labels.some((l) => ['qa', 'test', 'tester', 'testing', 'reviewer'].includes(l));
}

function isPmRole(name) {
  const labels = labelsOf(name);
  return labels.some((l) => ['pm', 'manager', 'lead', 'orchestrator', 'coordinator'].includes(l));
}

/**
 * Ajanların o anki odasını ve yükünü olay kütüğünden + canlı aktiviteden türetir.
 * Kural sırası önemli: bekleme > teslim (taze) > çalışma/test > PM > dinlenme.
 */
export function deriveCrew({ roster, tasks, events, sessions = [] }) {
  const HANDOFF_LINGER = 3 * 60 * 1000;
  const activeNames = new Set(sessions.flatMap((s) => (s.subagents || [])
    .filter((a) => a.running).map((a) => a.name)));
  // Bekleyen yalnızca, oturumu durduğunda elinde iş olan ajandır — o oturumun
  // geçmişteki tüm alt-ajanları değil.
  const waitingNames = new Set(sessions
    .filter((s) => s.waitingForUser && s.activeAgent)
    .map((s) => s.activeAgent));
  const toolByAgent = new Map(sessions.flatMap((s) => (s.subagents || [])
    .map((a) => [a.name, a.lastTool])));
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

  // Her oturum bir karakterdir: ajan tanımı olmayan projelerde ekranda görünen tek kişi budur.
  // Ajan kadrosu olan projede oturum orkestratördür (PM odası); kadrosu olmayanda
  // işi bizzat yapan tek kişidir, o yüzden çalışma odasına oturur.
  const busyRoom = roster.length ? 'pm' : 'work';

  const crew = sessions.map((session) => ({
    kind: 'session',
    name: session.title || session.sessionId.slice(0, 8),
    sessionId: session.sessionId,
    color: null,
    room: session.waitingForUser ? 'waiting' : session.running ? busyRoom : 'lounge',
    active: session.running,
    waiting: session.waitingForUser,
    idleAtDesk: false,
    tool: session.lastTool,
    question: session.question,
    queue: 0,
    currentTask: null,
    testRounds: 0,
    description: session.gitBranch ? `dal: ${session.gitBranch}` : '',
  }));

  crew.push(...roster.map((agent) => {
    const queue = (assignments.get(agent.name) || []).filter((t) => t.stage !== 'done');
    const active = activeNames.has(agent.name);
    const waiting = waitingNames.has(agent.name);
    const recentHandoff = events
      .filter((e) => e.from === agent.name && e.event === 'delivered')
      .some((e) => Date.now() - e.ts < HANDOFF_LINGER);

    // Oda gözleme dayanır: yalnızca gerçekten koşan ajan çalışma/test odasındadır.
    // Kuyruğu olup koşmayan masasında sırada bekler; boşta olan dinlenmeye geçer.
    // Çalışma/test odasına YALNIZCA gerçekten koşan ajan girer. Kuyruğu olup
    // koşmayan biri çalışmıyordur — dinlenme odasında bekler, yükü rozetinde görünür.
    let room;
    let idleAtDesk = false;
    if (active) room = isQaRole(agent.name) ? 'test' : 'work';   // koşuyorsa beklemiyordur
    else if (waiting) room = 'waiting';
    else if (recentHandoff) room = 'handoff';
    else if (isPmRole(agent.name)) room = 'pm';
    else { room = 'lounge'; idleAtDesk = queue.length > 0; }

    const current = queue.find((t) => t.status === 'in_progress') || queue[0] || null;

    return {
      ...agent,
      kind: 'agent',
      room,
      active,
      waiting,
      idleAtDesk,
      tool: toolByAgent.get(agent.name) || null,
      question: null,
      queue: queue.length,
      currentTask: current ? { id: current.id, subject: current.subject, key: current.key } : null,
      testRounds: queue.reduce((max, t) => Math.max(max, t.testRounds || 0), 0),
    };
  }));

  return crew;
}
