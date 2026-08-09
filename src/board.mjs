import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const DATA_DIR = path.join(os.homedir(), '.agent-board');
const OVERLAY_FILE = path.join(DATA_DIR, 'overlay.json');

export const STAGES = ['manager', 'dev', 'test', 'done'];

export function defaultStage(task) {
  if (task.status === 'completed') return 'done';
  if (task.status === 'in_progress') return 'dev';
  return 'manager';
}

let cache = null;

export async function readOverlay() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fsp.readFile(OVERLAY_FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

async function writeOverlay(data) {
  cache = data;
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(OVERLAY_FILE, JSON.stringify(data, null, 2));
}

export function taskKey(sessionId, taskId) {
  return `${sessionId}:${taskId}`;
}

export async function decorate(tasks) {
  const overlay = await readOverlay();
  return tasks.map((task) => {
    const key = taskKey(task.sessionId, task.id);
    const entry = overlay[key] || {};
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

export async function setStage(key, stage, owner) {
  if (!STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  const overlay = await readOverlay();
  const entry = overlay[key] || { testRounds: 0, history: [] };
  const previous = entry.stage;

  // Testten geriye dönüş = yeni bir test turu
  if (previous === 'test' && (stage === 'dev' || stage === 'manager')) {
    entry.testRounds = (entry.testRounds || 0) + 1;
  }

  entry.stage = stage;
  if (owner !== undefined) entry.owner = owner || null;
  entry.history = [...(entry.history || []), { stage, at: Date.now() }].slice(-40);
  overlay[key] = entry;
  await writeOverlay(overlay);
  return entry;
}
