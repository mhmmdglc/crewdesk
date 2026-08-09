import { Office } from './office.js';

const STAGE_LABEL = { manager: 'Manager', dev: 'Geliştirme', test: 'Test', done: 'Bitti' };

let selected = null;
let state = null;
let view = 'board';
const office = new Office(document.getElementById('officeCanvas'));

// Pano metinlerinin hepsi kullanıcı/model üretimi: task başlığı, ajan adı, soru
// metni. Hiçbiri innerHTML'e kaçışsız girmemeli.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

const ago = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}sn`;
  if (s < 3600) return `${Math.round(s / 60)}dk`;
  return `${Math.round(s / 3600)}sa`;
};

const realQuestions = (p) => (p.questions || []).filter((q) => q.isQuestion && q.fresh);
const idleTurns = (p) => (p.questions || []).length - realQuestions(p).length;

function meter(label, value, pct) {
  return `<div class="meter">
    <div class="label"><span>${esc(label)}</span><b>${esc(value)}</b></div>
    ${pct === null ? '' : `<div class="bar"><i style="width:${Number(pct)}%"></i></div>`}
  </div>`;
}

function meters(tokens) {
  if (!tokens.available) return '<span class="pill">token verisi yok</span>';
  const gauges = (tokens.gauges || []).map((g) => {
    const pct = Math.min(100, Math.round((g.used / g.limit) * 100));
    return meter(g.label || 'limit', `${pct}%`, pct);
  }).join('');
  const reset = new Date(tokens.windowResetsAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${meter('5 saatlik pencere', `${fmt(tokens.fiveHour)} token`, null)}
    ${meter('7 günlük pencere', `${fmt(tokens.sevenDay)} token`, null)}
    ${gauges}
    <span class="pill">kova yenilenme ${esc(reset)}</span>`;
}

function renderProjects() {
  document.getElementById('projects').innerHTML = state.projects.map((p) => {
    const status = p.activeCount ? 'active' : p.waitingCount ? 'waiting' : 'idle';
    const open = p.tasks.filter((t) => t.stage !== 'done').length;
    const asks = realQuestions(p).length;
    const idle = idleTurns(p);
    return `<button class="proj ${p.id === selected ? 'sel' : ''}" data-id="${esc(p.id)}">
      <div class="top">
        <span class="name"><span class="dot ${status}"></span> ${esc(p.name)}</span>
        <span class="pill">${p.sessions.length} oturum</span>
      </div>
      <div class="path">${esc(p.path)}</div>
      <div class="badges" style="margin-top:6px">
        ${open ? `<span class="badge">${open} açık iş</span>` : '<span class="badge">iş yok</span>'}
        ${p.activeCount ? `<span class="badge" style="color:var(--active)">${p.activeCount} çalışıyor</span>` : ''}
        ${asks ? `<span class="badge q">❓ ${asks} soru</span>` : ''}
        ${idle ? `<span class="badge">${idle} tur bitti</span>` : ''}
      </div>
    </button>`;
  }).join('');

  document.querySelectorAll('.proj').forEach((el) => {
    el.onclick = () => { selected = el.dataset.id; render(); };
  });
}

function renderSessions(project) {
  document.getElementById('sessions').innerHTML = project.sessions.map((s) => `
    <div class="sess">
      <div class="row"><span class="dot ${s.status}"></span>
        <span class="title">${esc(s.title || s.sessionId.slice(0, 8))}</span></div>
      ${s.lastTool ? `<div class="tool">▸ ${esc(s.lastTool)}</div>` : ''}
      <div class="meta">${esc(s.gitBranch || '—')} · ${ago(s.lastActivity)} önce · ${fmt(s.tokensFiveHour)} tok/5sa</div>
      ${s.subagents.map((a) => `<div class="sub">└ ${esc(a.name)}${a.lastTool ? ` · ${esc(a.lastTool)}` : ''}</div>`).join('')}
    </div>`).join('') || '<div class="empty">Bu projede son 7 günde oturum yok.</div>';
}

function renderColumns(project) {
  document.getElementById('cols').innerHTML = state.stages.map((stage) => {
    const cards = project.tasks.filter((t) => t.stage === stage);
    return `<div class="col">
      <h3><span>${esc(STAGE_LABEL[stage] || stage)}</span><span>${cards.length}</span></h3>
      ${cards.map((t) => `
        <div class="card">
          <div class="subject">${esc(t.subject)}</div>
          <div class="badges">
            ${t.owner ? `<span class="badge owner">${esc(t.owner)}</span>` : ''}
            ${t.testRounds ? `<span class="badge rounds">${t.testRounds}. test turu</span>` : ''}
            <span class="badge">#${esc(t.id)}</span>
          </div>
          <div class="move">
            ${state.stages.map((s) => `<button data-key="${esc(t.key)}" data-stage="${esc(s)}"
              class="${s === t.stage ? 'on' : ''}">${esc(STAGE_LABEL[s] || s)}</button>`).join('')}
          </div>
          <select class="assign" data-key="${esc(t.key)}" data-from="${esc(t.owner || '')}">
            <option value="">— kimseye atanmadı —</option>
            ${(project.crew || []).filter((a) => a.kind === 'agent').map((a) => `<option value="${esc(a.name)}"
              ${a.name === t.owner ? 'selected' : ''}>${esc(a.name)}${a.queue ? ` (${a.queue})` : ''}</option>`).join('')}
          </select>
        </div>`).join('') || '<div class="empty">boş</div>'}
    </div>`;
  }).join('');

  document.querySelectorAll('.move button').forEach((el) => {
    el.onclick = async () => {
      await post('/api/stage', { key: el.dataset.key, stage: el.dataset.stage });
      await load();
    };
  });

  document.querySelectorAll('select.assign').forEach((el) => {
    el.onchange = async () => {
      await post('/api/assign', {
        key: el.dataset.key,
        agent: el.value || null,
        from: el.dataset.from || null,
        project: selected,
        event: el.dataset.from && el.value ? 'delivered' : 'assigned',
      });
      await load();
    };
  });
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    console.warn('crewdesk:', res.status, detail.error || res.statusText);
  }
  return res;
}

// ---- uyarılar ----

const READ_KEY = 'crewdesk:read';
const HIDE_KEY = 'crewdesk:alerts-hidden';
const readKeys = new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
const notified = new Set();
const alertKey = (q) => `${q.sessionId}:${q.since}`;
let alertsHidden = localStorage.getItem(HIDE_KEY) === '1';
let alertSignature = '';

function saveRead() {
  localStorage.setItem(READ_KEY, JSON.stringify([...readKeys].slice(-300)));
}

function renderAlerts() {
  const all = state.projects.flatMap((p) => p.questions || []);
  const asks = all.filter((q) => q.isQuestion && q.fresh && !readKeys.has(alertKey(q)));
  const idle = all.length - all.filter((q) => q.isQuestion && q.fresh).length;
  const box = document.getElementById('alerts');

  const signature = `${alertsHidden}|${asks.map(alertKey).join(',')}|${idle}`;
  if (signature === alertSignature) return;
  alertSignature = signature;

  if (asks.length === 0 && idle === 0) {
    box.innerHTML = '';
    return;
  }

  if (alertsHidden) {
    box.innerHTML = `<button class="bell" id="alertsShow">🔔 ${asks.length ? `${asks.length} soru` : `${idle} tur bitti`}</button>`;
    document.getElementById('alertsShow').onclick = () => {
      alertsHidden = false;
      localStorage.removeItem(HIDE_KEY);
      alertSignature = '';
      renderAlerts();
    };
    return;
  }

  const shown = asks.slice(0, 3);
  const rest = asks.length - shown.length;

  box.innerHTML = `
    <div class="alert-head">
      <span>${asks.length ? `❓ ${asks.length} soru bekliyor` : 'yeni soru yok'}</span>
      <span>
        ${asks.length ? '<button id="markAll">tümünü okundu</button>' : ''}
        <button id="hideAlerts" title="gizle">gizle</button>
      </span>
    </div>
    ${shown.map((q) => `
      <div class="alert" data-project="${esc(q.project)}" data-key="${esc(alertKey(q))}">
        <div class="who">
          <span>❓ ${esc(q.projectName)}</span>
          <span>${ago(q.since)} önce <b class="x" title="okundu">×</b></span>
        </div>
        <div class="txt">${esc(q.text)}</div>
      </div>`).join('')}
    ${rest > 0 ? `<div class="alert more">+${rest} soru daha</div>` : ''}
    ${idle > 0 ? `<div class="alert quiet">${idle} sohbet turunu bitirmiş, sırada sen varsın</div>` : ''}`;

  document.getElementById('hideAlerts').onclick = () => {
    alertsHidden = true;
    localStorage.setItem(HIDE_KEY, '1');
    alertSignature = '';
    renderAlerts();
  };
  const markAll = document.getElementById('markAll');
  if (markAll) {
    markAll.onclick = () => {
      asks.forEach((q) => readKeys.add(alertKey(q)));
      saveRead();
      alertSignature = '';
      renderAlerts();
    };
  }

  box.querySelectorAll('.alert[data-project]').forEach((el) => {
    el.onclick = (event) => {
      if (event.target.classList.contains('x')) {
        readKeys.add(el.dataset.key);
        saveRead();
        alertSignature = '';
        renderAlerts();
        return;
      }
      selected = el.dataset.project;
      render();
    };
  });

  for (const q of asks) {
    const key = alertKey(q);
    if (notified.has(key)) continue;
    notified.add(key);
    if (window.Notification?.permission === 'granted') {
      new Notification(`${q.projectName} — sana soru soruldu`, { body: q.text.slice(0, 140) });
    }
  }
}

// ---- görünüm ----

function render() {
  if (!state) return;
  document.getElementById('meters').innerHTML = meters(state.tokens);
  document.getElementById('clock').textContent = new Date(state.generatedAt).toLocaleTimeString('tr-TR');
  if (!selected || !state.projects.some((p) => p.id === selected)) selected = state.projects[0]?.id || null;
  renderProjects();
  const project = state.projects.find((p) => p.id === selected);
  if (!project) return;
  renderSessions(project);
  renderColumns(project);
  office.update(project, state.roomLabels);
  const totalActive = state.projects.reduce((n, p) => n + p.activeCount, 0);
  document.getElementById('footer').textContent =
    `${state.projects.length} proje · ${totalActive} ajan çalışıyor · veri kaynağı ~/.claude (salt okunur)`;
}

function setView(next) {
  view = next;
  document.getElementById('boardView').hidden = next !== 'board';
  document.getElementById('officeView').hidden = next !== 'office';
  document.getElementById('tabBoard').classList.toggle('on', next === 'board');
  document.getElementById('tabOffice').classList.toggle('on', next === 'office');
  if (next === 'office') office.start(); else office.stop();
  localStorage.setItem('crewdesk:view', next);
}

async function load() {
  const res = await fetch('/api/state');
  state = await res.json();
  render();
  renderAlerts();
}

document.getElementById('tabBoard').onclick = () => setView('board');
document.getElementById('tabOffice').onclick = () => setView('office');

if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission().catch(() => {});
}

load();
setInterval(load, 4000);
setView(localStorage.getItem('crewdesk:view') || 'board');
