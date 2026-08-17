#!/usr/bin/env node
// crewdesk dürtme kancası (Stop hook).
//
// crewdesk hiçbir zaman ~/.claude'a yazmaz; dürtmeyi kendi dizinine bırakır:
//   ~/.crewdesk/nudges/<sessionId>.json
// Bu betik oturum duracakken çalışır, kendi oturumuna ait bir dürtme varsa onu
// tüketir ve turu bitirmek yerine soruyu Claude'a verir.
//
// Kancanın tek işi bu. Hata verirse ya da dosya yoksa sessizce çıkar: bozuk bir
// kanca kullanıcının Claude Code'unu bozar, o yüzden burada hiçbir şey fırlatmaz.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const NUDGE_DIR = path.join(os.homedir(), '.crewdesk', 'nudges');
const MAX_AGE_MS = 6 * 60 * 60 * 1000;   // bayat dürtme iletilmez
const MAX_TEXT = 2000;

function done(payload) {
  if (payload) process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
  if (raw.length > 1_000_000) done(null);      // beklenmedik girdi: karışma
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');

    // Zaten bir dürtme yüzünden devam ediyorsak tekrar engelleme: sonsuz döngü olur.
    if (input.stop_hook_active) done(null);

    const sessionId = String(input.session_id || '');
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(sessionId)) done(null);

    const file = path.join(NUDGE_DIR, `${sessionId}.json`);
    const nudge = JSON.parse(fs.readFileSync(file, 'utf8'));

    // Tüketilmiş sayılsın: bir daha aynı dürtme iletilmesin. Silme başarısız
    // olursa hiç iletmiyoruz — tekrar tekrar dürtmektense hiç dürtmemek yeğdir.
    fs.unlinkSync(file);

    const text = String(nudge.text || '').slice(0, MAX_TEXT).trim();
    const at = Number(nudge.at) || 0;
    if (!text) done(null);
    if (at && Date.now() - at > MAX_AGE_MS) done(null);

    done({ decision: 'block', reason: text });
  } catch {
    done(null);                                 // dosya yok, bozuk JSON, izin yok…
  }
});

// stdin hiç kapanmazsa kancayı bekletmeyelim
setTimeout(() => done(null), 4000).unref?.();
