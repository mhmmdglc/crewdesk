import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProjects, readTasks, readTokenWindows, readAgentRoster } from './sources.mjs';
import { decorate, setStage, setOwner, assertKey, ValidationError, STAGES } from './board.mjs';
import { readEvents, appendEvent, deriveCrew, ROOMS, ROOM_LABEL, EVENTS } from './events.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Yalnızca kendi sayfamızdan gelen isteklere izin ver: crewdesk kimlik doğrulaması
// olmayan lokal bir sunucu, dolayısıyla herhangi bir web sayfası ona POST atabilirdi.
function sameOrigin(req, host) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;                       // curl / fetch-without-origin
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// DNS-rebinding koruması: Host başlığı bizim dinlediğimiz adres olmalı
function hostAllowed(req, address, port) {
  const host = (req.headers.host || '').toLowerCase();
  if (!host) return false;
  const [name] = host.split(':');
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', address]);
  return allowed.has(name);
}

async function buildState() {
  const projects = await scanProjects();
  const tokens = readTokenWindows();
  const events = await readEvents();

  const enriched = [];
  for (const project of projects) {
    const tasks = [];
    for (const session of project.sessions) {
      tasks.push(...(await readTasks(session.sessionId)));
    }

    const decorated = await decorate(tasks);
    const roster = await readAgentRoster(project.path);
    const projectEvents = events.filter((e) => !e.project || e.project === project.id);

    enriched.push({
      ...project,
      crew: deriveCrew({ roster, tasks: decorated, events: projectEvents, sessions: project.sessions }),
      questions: project.sessions
        .filter((s) => s.waitingForUser && s.question)
        .map((s) => ({
          sessionId: s.sessionId,
          project: project.id,
          projectName: project.name,
          title: s.title || s.sessionId.slice(0, 8),
          text: s.question.text,
          isQuestion: Boolean(s.question.isQuestion),
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
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.destroy();
      throw new ValidationError('body too large');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('body must be valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('body must be a JSON object');
  }
  return parsed;
}

function optionalString(value, field, max = 200) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new ValidationError(`${field} must be a string of at most ${max} characters`);
  }
  return value;
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // sayfa yalnızca kendi kaynaklarını yükleyebilsin; inline script yok
      'content-security-policy':
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        + "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

export function createServer({ address = '127.0.0.1', port = 4600 } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    try {
      if (!hostAllowed(req, address, port)) {
        return json(res, 403, { error: 'host not allowed' });
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, await buildState());
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        return json(res, 200, { events: await readEvents() });
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST') {
        if (!sameOrigin(req, req.headers.host)) {
          return json(res, 403, { error: 'cross-origin request refused' });
        }
        const type = (req.headers['content-type'] || '').split(';')[0].trim();
        if (type !== 'application/json') {
          return json(res, 415, { error: 'content-type must be application/json' });
        }

        if (url.pathname === '/api/stage') {
          const body = await readBody(req);
          assertKey(body.key);
          const owner = body.owner === undefined ? undefined : optionalString(body.owner, 'owner', 120);
          const entry = await setStage(body.key, body.stage, owner);
          return json(res, 200, { ok: true, entry });
        }

        if (url.pathname === '/api/assign') {
          const body = await readBody(req);
          assertKey(body.key);
          const agent = optionalString(body.agent, 'agent', 120);
          const event = body.event === undefined ? 'assigned' : String(body.event);
          if (!EVENTS.includes(event)) {
            throw new ValidationError(`unknown event: ${event}`);
          }
          // önce kütük, sonra sahiplik: ikisi de doğrulandıktan sonra yazılır
          const record = await appendEvent({
            taskKey: body.key,
            taskId: optionalString(body.taskId, 'taskId', 32),
            project: optionalString(body.project, 'project', 256),
            from: optionalString(body.from, 'from', 120),
            to: agent,
            event,
          });
          await setOwner(body.key, agent);
          return json(res, 200, { ok: true, record });
        }

        return json(res, 404, { error: 'unknown endpoint' });
      }

      if (req.method === 'GET') return await serveStatic(res, url.pathname);

      res.writeHead(405).end('method not allowed');
    } catch (error) {
      if (error instanceof ValidationError) return json(res, 400, { error: error.message });
      json(res, 500, { error: 'internal error' });
    }
  });
}

export function start({ port = 4600, host = '127.0.0.1' } = {}) {
  const server = createServer({ address: host, port });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}` }));
  });
}
