import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
export const CLAUDE_DIR = path.join(HOME, '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const TASKS_DIR = path.join(CLAUDE_DIR, 'tasks');
const MONITOR_DIR = path.join(CLAUDE_DIR, 'session-monitor');

const TAIL_BYTES = 256 * 1024;
const MAX_TAIL_BYTES = 8 * 1024 * 1024;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_MS = 90 * 1000;
const IDLE_MS = 30 * 60 * 1000;

// Transcript'lerde tek satır 1 MB'ı aşabiliyor. Sabit kuyruk okuması böyle bir
// dosyada hiç tam satır yakalayamayıp oturumu tamamen kaybettiriyordu; o yüzden
// tam satır bulunana kadar pencereyi geriye doğru genişletiyoruz.
async function tailLines(file, bytes = TAIL_BYTES) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const { size } = await handle.stat();
    let window = bytes;

    for (let attempt = 0; attempt < 4; attempt++) {
      const start = Math.max(0, size - window);
      const length = size - start;
      if (length <= 0) return [];
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      const lines = buf.toString('utf8').split('\n');
      if (start > 0) lines.shift();          // baştaki yarım satırı at
      const complete = lines.filter((l) => l.trim().length > 0);
      if (complete.length > 0 || start === 0) return complete;
      window = Math.min(window * 4, MAX_TAIL_BYTES);
      if (window >= size) window = size;
    }
    return [];
  } catch {
    return [];
  } finally {
    await handle?.close();
  }
}

function parseLines(lines) {
  const out = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      // "null", "42", "[]" gibi geçerli JSON ama kayıt olmayan satırları atla:
      // aşağıdaki döngüler alan erişimi yapıyor.
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      out.push(value);
    } catch {
      /* partial or corrupt line */
    }
  }
  return out;
}

function toolsFromEntry(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((c) => c?.type === 'tool_use');
}

// Türkçe ve İngilizce soru kalıpları — "tur bitti" ile "sana soru soruldu" farkı bu.
// \b ASCII tabanlı olduğu için "kaldığımız" içindeki "mı" eşleşiyordu; Türkçe
// harfleri de kelime karakteri sayan kendi sınırımızı kuruyoruz.
const W = '0-9A-Za-zÇçĞğİıÖöŞşÜü_';
const ASK_PATTERNS = new RegExp(
  `(^|[^${W}])(mı|mi|mu|mü|musun|misin|mısın|müsün|hangisi|hangisini|ne yapayım|devam edeyim|edelim mi`
  + `|onaylıyor musun|onaylar mısın|ister misin|should i|shall i|which one|do you want|could you confirm)([^${W}]|$)`,
  'i',
);

function summarizeTurn(text, ts) {
  // kod bloklarını, tablo satırlarını ve dosya yollarını at; anlamlı son cümleyi bul
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s*[|>#\-*].*$/gm, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S*\/\S*\.\w+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = clean.split(/(?<=[.!?…])\s+/).filter((s) => s.trim().length > 12);
  const tail = sentences.slice(-2).join(' ').trim() || clean.slice(-160);
  const lastSentence = sentences[sentences.length - 1] || clean;

  return {
    text: tail.length > 180 ? '…' + tail.slice(-179) : tail,
    isQuestion: /\?\s*$/.test(lastSentence.trim()) || ASK_PATTERNS.test(lastSentence),
    ts,
  };
}

function statusFor(lastTs, awaitingInput) {
  const age = Date.now() - lastTs;
  if (awaitingInput) return 'waiting';
  if (age <= ACTIVE_MS) return 'active';
  if (age <= IDLE_MS) return 'idle';
  return 'dormant';
}

function prettyTool(name) {
  if (!name) return null;
  return name.replace(/^mcp__/, '').replace(/__/g, '·');
}

async function scanSession(file) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return null;
  if (Date.now() - stat.mtimeMs > SESSION_MAX_AGE_MS) return null;

  const entries = parseLines(await tailLines(file));
  if (entries.length === 0) return null;

  const sessionId = path.basename(file, '.jsonl');
  let cwd = null;
  let gitBranch = null;
  let model = null;
  let title = null;
  let lastTool = null;
  let lastAssistantTs = null;
  let lastQuestion = null;
  let openSidechain = false;
  let currentAgent = null;
  const subagents = new Map();

  for (const entry of entries) {
    if (entry?.cwd) cwd = entry.cwd;
    if (entry?.gitBranch) gitBranch = entry.gitBranch;
    if (entry?.customTitle || entry?.aiTitle) title = entry.customTitle || entry.aiTitle;
    if (entry?.message?.model) model = entry.message.model;

    const ts = entry.timestamp ? Date.parse(entry.timestamp) : null;

    // Ana oturum kullanıcıya döndü mü? Son asistan mesajı araç çağrısı içermiyorsa
    // tur bitmiştir ve sıra kullanıcıdadır — "Claude soru sordu" sinyali budur.
    if (entry.type === 'assistant' && !entry.isSidechain) {
      const content = entry?.message?.content;
      const tools = toolsFromEntry(entry);
      if (tools.length === 0 && Array.isArray(content)) {
        const text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim();
        if (text) lastQuestion = summarizeTurn(text, ts);
      } else {
        lastQuestion = null;
      }
    }
    if (entry.type === 'user' && !entry.isSidechain) lastQuestion = null;

    // Alt-ajan yaşam döngüsü: Agent çağrısı başlatır, sidechain akışı sürerken açıktır
    for (const tool of toolsFromEntry(entry)) {
      if (!entry.isSidechain && (tool.name === 'Agent' || tool.name === 'Task')) {
        currentAgent = tool.input?.subagent_type || tool.input?.name || tool.input?.description || 'agent';
        openSidechain = true;
        subagents.set(currentAgent, {
          name: currentAgent,
          type: tool.input?.subagent_type || 'agent',
          startedAt: ts,
          lastTool: null,
          lastTs: ts,
        });
      } else if (entry.isSidechain) {
        const key = currentAgent || 'sub-agent';
        const prev = subagents.get(key) || { name: key, type: 'sidechain', startedAt: ts };
        subagents.set(key, { ...prev, lastTool: prettyTool(tool.name), lastTs: ts });
        openSidechain = true;
      } else {
        lastTool = prettyTool(tool.name);
        if (ts) lastAssistantTs = ts;
      }
    }

    // Ana akışa dönen bir asistan mesajı alt-ajanın bittiği anlamına gelir
    if (entry.type === 'assistant' && !entry.isSidechain && openSidechain && toolsFromEntry(entry).length === 0) {
      openSidechain = false;
    }
  }

  const lastTs = stat.mtimeMs;
  const idle = Date.now() - lastTs;
  // "Sana soru soruldu" yalnızca taze oturumlar için anlamlıdır; 8 saat önce
  // kapanmış bir sohbet seni beklemiyor, sadece bitmiş.
  const FRESH_MS = 8 * 60 * 60 * 1000;
  const waitingForUser = Boolean(lastQuestion) && idle > 5 * 1000 && idle < FRESH_MS;
  const running = !waitingForUser && idle <= ACTIVE_MS;

  return {
    sessionId,
    file,
    cwd: cwd || null,
    gitBranch,
    model,
    title: title || null,
    lastTool,
    lastActivity: lastTs,
    lastAssistantTs,
    status: waitingForUser ? 'waiting' : statusFor(lastTs, false),
    running,
    waitingForUser,
    question: waitingForUser ? lastQuestion : null,
    activeAgent: openSidechain && running ? currentAgent : null,
    subagents: [...subagents.values()],
  };
}

// Bir alt-ajan çalışırken ana transcript'e satır yazılmaz; canlılık sinyali
// yalnızca kendi dosyasının mtime'ında görünür. Ana dosyaya bakmak, 90 sn'den
// uzun süren her alt-ajanı görünmez yapıyordu.
async function scanSubagents(sessionDir) {
  const dir = path.join(sessionDir, 'subagents');
  const files = await fsp.readdir(dir).catch(() => []);
  const agents = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const full = path.join(dir, file);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs > SESSION_MAX_AGE_MS) continue;

    const entries = parseLines(await tailLines(full, 64 * 1024));
    let lastTool = null;
    let name = null;
    for (const entry of entries) {
      // Claude Code alt-ajanın rolünü attributionAgent alanında taşıyor
      if (entry.attributionAgent) name = entry.attributionAgent;
      for (const tool of toolsFromEntry(entry)) lastTool = prettyTool(tool.name);
    }

    agents.push({
      name: name || file.replace(/^agent-/, '').replace(/\.jsonl$/, '').slice(0, 24),
      lastTool,
      lastTs: stat.mtimeMs,
      running: Date.now() - stat.mtimeMs <= ACTIVE_MS,
    });
  }

  agents.sort((a, b) => b.lastTs - a.lastTs);
  return agents;
}

function decodeProjectDir(dirName) {
  if (!dirName.startsWith('-')) return dirName;
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}

export async function scanProjects() {
  const dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  const projects = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_DIR, dir.name);
    const files = await fsp.readdir(dirPath).catch(() => []);
    const sessions = [];

    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      // Tek bozuk oturum tüm listeyi düşürmesin: hata veren dosyayı atlayıp devam et
      let session;
      try {
        session = await scanSession(path.join(dirPath, f));
      } catch {
        continue;
      }
      if (!session) continue;
      // Alt-ajanlar ayrı dosyada koşuyor: <sessionId>/subagents/agent-*.jsonl
      try {
        session.subagents = await scanSubagents(path.join(dirPath, session.sessionId));
      } catch {
        session.subagents = [];
      }
      session.activeAgent = session.subagents.find((a) => a.running)?.name || null;
      // Alt-ajanı koşan oturum çalışıyordur; senin cevabını beklemiyordur
      if (session.activeAgent) {
        session.running = true;
        session.waitingForUser = false;
        session.question = null;
        session.status = 'active';
      }
      sessions.push(session);
    }

    if (sessions.length === 0) continue;

    sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    const cwd = sessions.find((s) => s.cwd)?.cwd || decodeProjectDir(dir.name);

    projects.push({
      id: dir.name,
      path: cwd,
      name: path.basename(cwd),
      sessions,
      lastActivity: sessions[0].lastActivity,
      activeCount: sessions.filter((s) => s.status === 'active').length,
      waitingCount: sessions.filter((s) => s.status === 'waiting').length,
    });
  }

  projects.sort((a, b) => b.lastActivity - a.lastActivity);
  return projects;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

function frontField(block, key) {
  const match = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

// Her projenin kendi ajan kadrosu vardır: <proje>/.claude/agents/*.md
export async function readAgentRoster(projectPath) {
  // projectPath transkriptteki serbest "cwd" alanından gelir. Doğrulanmazsa HOME dışındaki
  // bir dizinin .claude/agents/*.md dosyaları okunup /api/state'te yayınlanabiliyordu.
  const resolved = path.resolve(String(projectPath || ''));
  const home = path.resolve(os.homedir());
  if (resolved !== home && !resolved.startsWith(home + path.sep)) return [];
  const dir = path.join(resolved, '.claude', 'agents');
  const files = await fsp.readdir(dir).catch(() => []);
  const roster = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const raw = await fsp.readFile(path.join(dir, file), 'utf8').catch(() => null);
    if (!raw) continue;
    const front = raw.match(FRONT_MATTER);
    if (!front) continue;
    const name = frontField(front[1], 'name') || path.basename(file, '.md');
    const description = frontField(front[1], 'description') || '';
    roster.push({
      name,
      color: frontField(front[1], 'color'),
      restricted: Boolean(frontField(front[1], 'tools')),
      description: description.replace(/^["']|["']$/g, '').slice(0, 160),
    });
  }

  roster.sort((a, b) => a.name.localeCompare(b.name));
  return roster;
}

export async function readTasks(sessionId) {
  const dir = path.join(TASKS_DIR, sessionId);
  const files = await fsp.readdir(dir).catch(() => []);
  const tasks = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, f), 'utf8');
      const task = JSON.parse(raw);
      if (task?.id) tasks.push({ ...task, sessionId });
    } catch {
      /* skip unreadable task */
    }
  }
  tasks.sort((a, b) => Number(a.id) - Number(b.id));
  return tasks;
}

const HOUR = 3600;

export function readTokenWindows() {
  const bucketsFile = path.join(MONITOR_DIR, 'token-buckets.json');
  const officialFile = path.join(MONITOR_DIR, 'official-usage.json');

  let buckets = null;
  let official = null;
  try {
    buckets = JSON.parse(fs.readFileSync(bucketsFile, 'utf8'));
  } catch {
    /* monitor data not present */
  }
  try {
    official = JSON.parse(fs.readFileSync(officialFile, 'utf8'));
  } catch {
    /* optional */
  }

  const nowBucket = Math.floor(Date.now() / 1000 / HOUR);
  const sumWindow = (map, hours) => {
    if (!map) return 0;
    let total = 0;
    for (const [key, value] of Object.entries(map)) {
      const bucket = Number(key.includes(':') ? key.split(':')[0] : key);
      const amount = Number(value);
      // kova değeri string/null gelirse toplam string'e dönüyordu
      if (!Number.isFinite(bucket) || !Number.isFinite(amount)) continue;
      if (bucket > nowBucket - hours && bucket <= nowBucket) total += amount;
    }
    return total;
  };

  const perSession = {};
  if (buckets?.session) {
    for (const [key, value] of Object.entries(buckets.session)) {
      const [bucketStr, sessionId] = key.split(':');
      const bucket = Number(bucketStr);
      if (!Number.isFinite(bucket) || !sessionId) continue;
      const amount = Number(value);
      if (bucket <= nowBucket - 5 || bucket > nowBucket || !Number.isFinite(amount)) continue;
      perSession[sessionId] = (perSession[sessionId] || 0) + amount;
    }
  }

  const gauges = Array.isArray(official?.gauges) ? official.gauges : [];

  return {
    available: Boolean(buckets),
    fiveHour: sumWindow(buckets?.global, 5),
    sevenDay: sumWindow(buckets?.global, 24 * 7),
    perSessionFiveHour: perSession,
    gauges,
    officialAvailable: gauges.length > 0,
    windowResetsAt: (nowBucket + 1) * HOUR * 1000,
  };
}
