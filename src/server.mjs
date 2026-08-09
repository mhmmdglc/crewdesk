import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProjects, readTasks, readTokenWindows, readAgentRoster } from './sources.mjs';
import { decorate, setStage, setOwner, STAGES } from './board.mjs';
import { readEvents, appendEvent, deriveCrew, ROOMS, ROOM_LABEL } from './events.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function buildState() {
  const projects = await scanProjects();
  const tokens = readTokenWindows();

  const enriched = [];
  for (const project of projects) {
    const tasks = [];
    for (const session of project.sessions) {
      tasks.push(...(await readTasks(session.sessionId)));
    }
    const decorated = await decorate(tasks);
    const roster = await readAgentRoster(project.path);
    const events = (await readEvents()).filter((e) => !e.project || e.project === project.id);

    enriched.push({
      ...project,
      crew: deriveCrew({ roster, tasks: decorated, events, sessions: project.sessions }),
      questions: project.sessions
        .filter((s) => s.waitingForUser && s.question)
        .map((s) => ({
          sessionId: s.sessionId,
          project: project.id,
          projectName: project.name,
          title: s.title || s.sessionId.slice(0, 8),
          text: s.question.text,
          isQuestion: Boolean(s.question.isQuestion),
          // uyarı yalnızca taze sohbetler için; eskiyen sohbet seni beklemiyor, sadece durmuş
          fresh: Date.now() - s.lastActivity < 2 * 60 * 60 * 1000,
          since: s.lastActivity,
        })),
      sessions: project.sessions.map((s) => ({
        ...s,
        tokensFiveHour: tokens.perSessionFiveHour[s.sessionId] || 0,
      })),
      tasks: decorated,
      stageCounts: STAGES.reduce((acc, stage) => {
        acc[stage] = decorated.filter((t) => t.stage === stage).length;
        return acc;
      }, {}),
    });
  }

  return {
    generatedAt: Date.now(),
    stages: STAGES,
    rooms: ROOMS,
    roomLabels: ROOM_LABEL,
    projects: enriched,
    tokens,
  };
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    try {
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, await buildState());
      }

      if (req.method === 'POST' && url.pathname === '/api/stage') {
        const body = await readBody(req);
        if (!body.key || !body.stage) return json(res, 400, { error: 'key ve stage zorunlu' });
        const entry = await setStage(body.key, body.stage, body.owner);
        return json(res, 200, { ok: true, entry });
      }

      // İşi bir ajana ata: hem sahibi yaz, hem devir teslim kütüğüne düş
      if (req.method === 'POST' && url.pathname === '/api/assign') {
        const body = await readBody(req);
        if (!body.key) return json(res, 400, { error: 'key zorunlu' });
        await setOwner(body.key, body.agent || null);
        const record = await appendEvent({
          taskKey: body.key,
          taskId: body.taskId ?? null,
          project: body.project ?? null,
          from: body.from ?? null,
          to: body.agent || null,
          event: body.event || 'assigned',
        });
        return json(res, 200, { ok: true, record });
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        return json(res, 200, { events: await readEvents() });
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET') return await serveStatic(res, url.pathname);

      res.writeHead(405).end('method not allowed');
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}

export function start({ port = 4600, host = '127.0.0.1' } = {}) {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}` }));
  });
}
