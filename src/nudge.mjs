// Dürtme kuyruğu. crewdesk yalnızca kendi dizinine yazar; dürtmeyi oturuma
// taşıyan şey hooks/crewdesk-nudge.mjs, yani Claude Code'un kendi Stop kancası.
//
// Bir dürtme dosyası duruyorsa "henüz iletilmedi" demektir; kanca onu tüketince
// dosya kaybolur ve arayüz de bunu görür. Durumu ayrıca saklamıyoruz — dosyanın
// varlığı zaten gerçeğin ta kendisi.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './board.mjs';

const NUDGE_DIR = path.join(DATA_DIR, 'nudges');

// Oturum kimlikleri UUID; dosya adına gideceği için sıkı tutuyoruz.
const SESSION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
export const MAX_NUDGE_TEXT = 2000;

export class NudgeError extends Error {}

export function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_PATTERN.test(sessionId) || sessionId.includes('..')) {
    throw new NudgeError('sessionId must be a plain session identifier');
  }
  return sessionId;
}

export function assertText(text) {
  if (typeof text !== 'string') throw new NudgeError('text must be a string');
  const trimmed = text.trim();
  if (!trimmed) throw new NudgeError('text must not be empty');
  if (trimmed.length > MAX_NUDGE_TEXT) throw new NudgeError(`text must be at most ${MAX_NUDGE_TEXT} characters`);
  return trimmed;
}

export async function writeNudge(sessionId, text) {
  assertSessionId(sessionId);
  const body = assertText(text);
  await fsp.mkdir(NUDGE_DIR, { recursive: true });

  const file = path.join(NUDGE_DIR, `${sessionId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  const entry = { text: body, at: Date.now() };
  await fsp.writeFile(tmp, JSON.stringify(entry, null, 2));
  await fsp.rename(tmp, file);                 // atomik değiştirme
  return entry;
}

// Bekleyen dürtmeler: <sessionId> -> { text, at }
export async function readPendingNudges() {
  const files = await fsp.readdir(NUDGE_DIR).catch(() => []);
  const pending = Object.create(null);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const sessionId = file.slice(0, -'.json'.length);
    if (!SESSION_PATTERN.test(sessionId)) continue;
    const raw = await fsp.readFile(path.join(NUDGE_DIR, file), 'utf8').catch(() => null);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      pending[sessionId] = { text: String(parsed.text || ''), at: Number(parsed.at) || 0 };
    } catch {
      /* yarım yazılmış dosya: yok say */
    }
  }
  return pending;
}

export async function cancelNudge(sessionId) {
  assertSessionId(sessionId);
  await fsp.unlink(path.join(NUDGE_DIR, `${sessionId}.json`)).catch(() => {});
}
