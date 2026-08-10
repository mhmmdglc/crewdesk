import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const DATA_DIR = path.join(os.homedir(), '.crewdesk');
const OVERLAY_FILE = path.join(DATA_DIR, 'overlay.json');

export const STAGES = ['manager', 'dev', 'test', 'done'];

// Anahtar biçimi sabit: "<sessionId>:<taskId>". Serbest anahtar kabul etmek
// __proto__ gibi değerlerin prototip zincirine yazılmasına yol açıyordu.
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}:[A-Za-z0-9._-]{1,32}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class ValidationError extends Error {}

export function assertKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) {
    throw new ValidationError('key must look like "<sessionId>:<taskId>"');
  }
  return key;
}

export function defaultStage(task) {
  if (task.status === 'completed') return 'done';
  if (task.status === 'in_progress') return 'dev';
  return 'manager';
}

let cache = null;
let cacheMtime = 0;
let loading = null;
let writeChain = Promise.resolve();

async function loadFromDisk() {
  try {
    const [raw, stat] = await Promise.all([
      fsp.readFile(OVERLAY_FILE, 'utf8'),
      fsp.stat(OVERLAY_FILE),
    ]);
    const parsed = JSON.parse(raw);
    // prototipsiz nesne: miras alınan alan yok
    const clean = Object.create(null);
    for (const [key, value] of Object.entries(parsed)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      clean[key] = value;
    }
    cacheMtime = stat.mtimeMs;
    return clean;
  } catch {
    cacheMtime = 0;
    return Object.create(null);
  }
}

export async function readOverlay() {
  // Disk dışarıdan değiştiyse (ikinci örnek, elle düzenleme) yeniden oku
  if (cache) {
    const stat = await fsp.stat(OVERLAY_FILE).catch(() => null);
    const mtime = stat?.mtimeMs || 0;
    if (mtime === cacheMtime) return cache;
    cache = null;
  }
  // tek uçuş: eşzamanlı çağrılar aynı yüklemeyi paylaşır, ayrı ayrı {} üretmez
  if (!loading) {
    loading = loadFromDisk().then((data) => {
      cache = data;
      loading = null;
      return data;
    });
  }
  return loading;
}

// Yazımlar sıraya girer ve her biri diski yeniden okuyup üstüne yazar:
// böylece iki örnek birbirinin kaydını ezmez.
function enqueue(mutate) {
  const next = writeChain.then(async () => {
    const current = await readOverlay();
    // Değişikliği kopya üzerinde yap: yazım hata verirse bellekteki hâli kirlenmez,
    // yoksa başarısız kayıt bir sonraki başarılı yazımla diske sızıyordu.
    const draft = structuredClone(current);
    const result = mutate(draft);
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${OVERLAY_FILE}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(draft, null, 2));
      await fsp.rename(tmp, OVERLAY_FILE);         // atomik değiştirme
    } catch (error) {
      cache = null;                                // sonraki okuma diskten tazelensin
      cacheMtime = 0;
      throw error;
    }
    const stat = await fsp.stat(OVERLAY_FILE).catch(() => null);
    cacheMtime = stat?.mtimeMs || 0;
    cache = draft;
    return result;
  });
  writeChain = next.catch(() => {});
  return next;
}

export function taskKey(sessionId, taskId) {
  return `${sessionId}:${taskId}`;
}

export async function decorate(tasks) {
  const overlay = await readOverlay();
  return tasks.map((task) => {
    const key = taskKey(task.sessionId, task.id);
    const entry = Object.prototype.hasOwnProperty.call(overlay, key) ? overlay[key] : {};
    return {
      ...task,
      key,
      stage: entry.stage || defaultStage(task),
      owner: entry.owner || null,
      testRounds: entry.testRounds || 0,
      history: entry.history || [],
      manualStage: Boolean(entry.stage),
    };
  });
}

function entryFor(overlay, key) {
  if (!Object.prototype.hasOwnProperty.call(overlay, key)) {
    overlay[key] = { testRounds: 0, history: [] };
  }
  return overlay[key];
}

export async function setOwner(key, owner) {
  assertKey(key);
  return enqueue((overlay) => {
    const entry = entryFor(overlay, key);
    entry.owner = owner || null;
    return entry;
  });
}

export async function setStage(key, stage, owner) {
  assertKey(key);
  // Ham değeri mesaja gömme: derin iç içe bir dizi stringify'da RangeError atıp
  // 400 yerine 500 döndürüyordu. Önce tür, sonra liste kontrolü.
  if (typeof stage !== 'string') throw new ValidationError('stage must be a string');
  if (!STAGES.includes(stage)) throw new ValidationError(`stage must be one of: ${STAGES.join(', ')}`);

  return enqueue((overlay) => {
    const entry = entryFor(overlay, key);
    const previous = entry.stage;

    if (previous === stage && (owner === undefined || entry.owner === (owner || null))) {
      return entry;   // aynı durum → no-op, geçmişe kayıt düşme
    }

    // Testten geriye dönüş = yeni bir test turu
    if (previous === 'test' && (stage === 'dev' || stage === 'manager')) {
      entry.testRounds = (entry.testRounds || 0) + 1;
    }

    entry.stage = stage;
    if (owner !== undefined) entry.owner = owner || null;
    entry.history = [...(entry.history || []), { stage, at: Date.now() }].slice(-40);
    return entry;
  });
}
