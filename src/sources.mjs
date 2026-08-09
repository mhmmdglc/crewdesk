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
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_MS = 90 * 1000;
const IDLE_MS = 30 * 60 * 1000;

async function tailLines(file, bytes = TAIL_BYTES) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (length <= 0) return [];
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim().length > 0);
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
      out.push(JSON.parse(line));
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
const ASK_PATTERNS = /\b(mı|mi|mu|mü|musun|misin|mısın|müsün|hangisi|hangisini|ister misin|onaylıyor|onaylar mısın|ne yapayım|devam edeyim|edelim mi|should i|shall i|which one|do you want|confirm)\b/i;

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
    if (entry.cwd) cwd = entry.cwd;
    if (entry.gitBranch) gitBranch = entry.gitBranch;
    if (entry.customTitle || entry.aiTitle) title = entry.customTitle || entry.aiTitle;
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
      const session = await scanSession(path.join(dirPath, f));
      if (session) sessions.push(session);
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
  const dir = path.join(projectPath, '.claude', 'agents');
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
      if (!Number.isFinite(bucket)) continue;
      if (bucket > nowBucket - hours && bucket <= nowBucket) total += value;
    }
    return total;
  };

  const perSession = {};
  if (buckets?.session) {
    for (const [key, value] of Object.entries(buckets.session)) {
      const [bucketStr, sessionId] = key.split(':');
      const bucket = Number(bucketStr);
      if (!Number.isFinite(bucket) || !sessionId) continue;
      if (bucket <= nowBucket - 5 || bucket > nowBucket) continue;
      perSession[sessionId] = (perSession[sessionId] || 0) + value;
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
