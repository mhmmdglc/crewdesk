import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProjects, readTasks, readTokenWindows, readAgentRoster } from './sources.mjs';
import { decorate, setStage, setOwner, assertKey, ValidationError, STAGES } from './board.mjs';
import { readEvents, appendEvent, deriveCrew, ROOMS, EVENTS } from './events.mjs';
import { writeNudge, readPendingNudges, cancelNudge, assertSessionId, NudgeError } from './nudge.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY = 256 * 1024;
// Tavanı aşan gövdeyi 413 dönebilmek için yine de okuyup atarız; bu da sonsuz
// olmasın diye ikinci bir sınır.
const DRAIN_LIMIT = 4 * 1024 * 1024;

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

// Host başlığından port'u ayırır; IPv6 köşeli parantezli biçimi de tanır
// Hata yanıtları da tip ve güvenlik başlığı taşısın: sniff edilecek bir gövde bırakma
function plain(res, code, body) {
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

function hostName(host) {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  return host.split(':')[0];
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isIpLiteral(name) {
  if (IPV4.test(name)) return name.split('.').every((part) => Number(part) <= 255);
  return /^\[[0-9a-f:.]+\]$/.test(name);           // IPv6 literal
}

// DNS-rebinding koruması: Host başlığı bizim dinlediğimiz adres olmalı
function hostAllowed(req, address, port) {
  const host = (req.headers.host || '').toLowerCase();
  if (!host) return false;
  const name = hostName(host);
  // Port da bizim dinlediğimiz port olmalı; yoksa varsayılan 80/443 kastedilmiştir
  const declared = host.slice(name.length).startsWith(':') ? host.slice(name.length + 1) : '';
  if (declared !== String(port) && !(declared === '' && (port === 80 || port === 443))) return false;
  // Joker bind'de (0.0.0.0 / ::) hangi arayüzden gelineceğini bilemeyiz; tarayıcı
  // Host olarak makinenin LAN IP'sini gönderir. Bu yüzden Host'un IP-literal (ya da
  // localhost) olması yeterli sayılır — rastgele bir DNS adı hâlâ reddedilir,
  // dolayısıyla rebinding koruması ayakta kalır.
  if (address === '0.0.0.0' || address === '::') {
    return name === 'localhost' || isIpLiteral(name);
  }
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', address]);
  return allowed.has(name);
}

async function buildState() {
  const projects = await scanProjects();
  const tokens = readTokenWindows();
  const events = await readEvents();
  const nudges = await readPendingNudges();

  const enriched = [];
  for (const project of projects) {
    const tasks = [];
    for (const session of project.sessions) {
      tasks.push(...(await readTasks(session.sessionId)));
    }

    const decorated = await decorate(tasks);
    // Okunamayan bir kadro dizini tüm durumu düşürmesin: kadrosuz devam et
    const roster = await readAgentRoster(project.path).catch(() => []);
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
        // Dosya duruyorsa kanca henüz tüketmemiş demektir: dürtme yolda.
        pendingNudge: Object.prototype.hasOwnProperty.call(nudges, s.sessionId)
          ? nudges[s.sessionId]
          : null,
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

// Gövde tavanı aşımı bir doğrulama hatası değil, 413'tür; ayırt edebilmek için
// kendi sınıfı var.
class PayloadTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 413;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      // Soketi koparmak istemciye yanıt yerine "empty reply" verdiriyordu. Gövdeyi
      // biriktirmeyi bırakıp okumaya devam ediyoruz ki düzgün bir 413 dönebilelim;
      // makul olmayan boyutta ise okumayı da kesiyoruz.
      tooLarge = true;
      if (size > DRAIN_LIMIT) break;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new PayloadTooLargeError('body too large');
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
    plain(res, 403, 'forbidden');
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
    plain(res, 404, 'not found');
  }
}

export function createServer({ address = '127.0.0.1', port = 4600 } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    try {
      if (!hostAllowed(req, address, port)) {
        return json(res, 403, { error: 'host not allowed' });
      }

      // HEAD, GET gibi ele alınır; Node gövdeyi kendisi atar
      const readMethod = req.method === 'HEAD' ? 'GET' : req.method;

      if (readMethod === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, await buildState());
      }

      if (readMethod === 'GET' && url.pathname === '/api/events') {
        return json(res, 200, { events: await readEvents() });
      }

      if (readMethod === 'GET' && url.pathname === '/api/health') {
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

        // Dürtme: crewdesk yalnızca ~/.crewdesk/nudges/ altına yazar. Oturuma
        // taşıyan şey Claude Code'un Stop kancası (hooks/crewdesk-nudge.mjs).
        if (url.pathname === '/api/nudge') {
          const body = await readBody(req);
          assertSessionId(body.sessionId);
          if (body.cancel) {
            await cancelNudge(body.sessionId);
            return json(res, 200, { ok: true, pendingNudge: null });
          }
          const entry = await writeNudge(body.sessionId, body.text);
          return json(res, 200, { ok: true, pendingNudge: entry });
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
          // Ham değeri mesaja gömme: derin iç içe bir dizi stringify'da RangeError
          // atıp 400 yerine 500 döndürüyordu. Önce tür, sonra liste kontrolü.
          const event = body.event === undefined ? 'assigned' : body.event;
          if (typeof event !== 'string') {
            throw new ValidationError('event must be a string');
          }
          if (!EVENTS.includes(event)) {
            throw new ValidationError(`event must be one of: ${EVENTS.join(', ')}`);
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

      if (readMethod === 'GET') return await serveStatic(res, url.pathname);

      plain(res, 405, 'method not allowed');
    } catch (error) {
      if (error instanceof ValidationError) return json(res, 400, { error: error.message });
      if (error instanceof NudgeError) return json(res, 400, { error: error.message });
      if (error instanceof PayloadTooLargeError) return json(res, 413, { error: error.message });
      // İstemciye iç detay sızmasın, ama 500'ün sebebi sunucu tarafında görünsün
      console.error(`crewdesk: ${req.method} ${url.pathname} failed`, error);
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
