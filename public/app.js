import { Office } from './office.js';
import { t, lang, setLang, LANGUAGES } from './i18n.js';

const stageLabel = (s) => t({ manager: 'stageManager', dev: 'stageDev', test: 'stageTest', done: 'stageDone' }[s] || s);

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

// Saat biçimi arayüz diliyle aynı locale'i kullansın; dil kodları (en, tr, es,
// zh, ja, de) doğrudan geçerli birer locale etiketi.
const clock = (ts, opts) => new Date(ts).toLocaleTimeString(lang(), opts);

const ago = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}${t('seconds')}`;
  if (s < 3600) return `${Math.round(s / 60)}${t('minutes')}`;
  return `${Math.round(s / 3600)}${t('hours')}`;
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
  if (!tokens.available) return `<span class="pill">${t('noTokenData')}</span>`;
  const gauges = (tokens.gauges || []).map((g) => {
    const pct = Math.min(100, Math.round((g.used / g.limit) * 100));
    return meter(g.label || 'limit', `${pct}%`, pct);
  }).join('');
  const reset = clock(tokens.windowResetsAt, { hour: '2-digit', minute: '2-digit' });
  return `${meter(t('fiveHourWindow'), `${fmt(tokens.fiveHour)} ${t('tokens')}`, null)}
    ${meter(t('sevenDayWindow'), `${fmt(tokens.sevenDay)} ${t('tokens')}`, null)}
    ${gauges}
    <span class="pill">${t('bucketResets')} ${esc(reset)}</span>`;
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
        <span class="pill">${t('sessions', p.sessions.length)}</span>
      </div>
      <div class="path">${esc(p.path)}</div>
      <div class="badges" style="margin-top:6px">
        ${open ? `<span class="badge">${t('openWork', open)}</span>` : `<span class="badge">${t('noWork')}</span>`}
        ${p.activeCount ? `<span class="badge" style="color:var(--active)">${t('running', p.activeCount)}</span>` : ''}
        ${asks ? `<span class="badge q">❓ ${t('questions', asks)}</span>` : ''}
        ${idle ? `<span class="badge">${t('turnsDone', idle)}</span>` : ''}
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
      <div class="meta">${esc(s.gitBranch || '—')} · ${ago(s.lastActivity)} ${t('ago')} · ${fmt(s.tokensFiveHour)} ${t('tokens')}/5h</div>
      ${s.subagents.map((a) => `<div class="sub">└ ${esc(a.name)}${a.lastTool ? ` · ${esc(a.lastTool)}` : ''}</div>`).join('')}
    </div>`).join('') || `<div class="empty">${t('noSessions')}</div>`;
}

function renderColumns(project) {
  document.getElementById('cols').innerHTML = state.stages.map((stage) => {
    const cards = project.tasks.filter((t) => t.stage === stage);
    return `<div class="col">
      <h3><span>${esc(stageLabel(stage))}</span><span>${cards.length}</span></h3>
      ${cards.map((task) => `
        <div class="card">
          <div class="subject">${esc(task.subject)}</div>
          <div class="badges">
            ${task.owner ? `<span class="badge owner">${esc(task.owner)}</span>` : ''}
            ${task.testRounds ? `<span class="badge rounds">${esc(t('testRound', task.testRounds))}</span>` : ''}
            <span class="badge">#${esc(task.id)}</span>
          </div>
          <div class="move" role="group" aria-label="${esc(t('moveTask', task.subject || task.id))}">
            ${state.stages.map((s) => `<button data-key="${esc(task.key)}" data-stage="${esc(s)}"
              aria-pressed="${s === task.stage}"
              class="${s === task.stage ? 'on' : ''}">${esc(stageLabel(s))}</button>`).join('')}
          </div>
          <select class="assign" data-key="${esc(task.key)}" data-from="${esc(task.owner || '')}">
            <option value="">${esc(t('unassigned'))}</option>
            ${(project.crew || []).filter((a) => a.kind === 'agent').map((a) => `<option value="${esc(a.name)}"
              ${a.name === task.owner ? 'selected' : ''}>${esc(a.name)}${a.queue ? ` (${a.queue})` : ''}</option>`).join('')}
          </select>
        </div>`).join('') || `<div class="empty">${esc(t('empty'))}</div>`}
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
    box.innerHTML = `<button class="bell" id="alertsShow">🔔 ${esc(asks.length ? t('questions', asks.length) : t('turnsDone', idle))}</button>`;
    document.getElementById('alertsShow').onclick = () => {
      alertsHidden = false;
      if (window.Notification && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
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
      <span>${asks.length ? `❓ ${esc(t('alertsWaiting', asks.length))}` : esc(t('alertsNone'))}</span>
      <span>
        ${asks.length ? `<button id="markAll">${esc(t('markAllRead'))}</button>` : ''}
        <button id="hideAlerts" title="${esc(t('hide'))}">${esc(t('hide'))}</button>
      </span>
    </div>
    ${shown.map((q) => `
      <div class="alert" role="button" tabindex="0" data-project="${esc(q.project)}" data-key="${esc(alertKey(q))}">
        <div class="who">
          <span>❓ ${esc(q.projectName)}</span>
          <span>${ago(q.since)} ${t('ago')} <button class="x" aria-label="${esc(t('markRead'))}" title="${esc(t('markRead'))}">×</button></span>
        </div>
        <div class="txt">${esc(q.text)}</div>
      </div>`).join('')}
    ${rest > 0 ? `<div class="alert more">${t('moreQuestions', rest)}</div>` : ''}
    ${idle > 0 ? `<div class="alert quiet">${t('turnsIdle', idle)}</div>` : ''}`;

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
    // kart artık role="button" tabindex="0": klavyeden de aynı şey olmalı
    el.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      el.onclick(event);
    };
  });

  for (const q of asks) {
    const key = alertKey(q);
    if (notified.has(key)) continue;
    notified.add(key);
    if (window.Notification?.permission === 'granted') {
      new Notification(t('notifyTitle', q.projectName), { body: q.text.slice(0, 140) });
    }
  }
}

// ---- görünüm ----

function render() {
  if (!state) return;
  document.getElementById('meters').innerHTML = meters(state.tokens);
  document.getElementById('clock').textContent = clock(state.generatedAt);
  if (!selected || !state.projects.some((p) => p.id === selected)) selected = state.projects[0]?.id || null;
  renderProjects();
  const project = state.projects.find((p) => p.id === selected);
  if (project) {
    renderSessions(project);
    renderColumns(project);
  } else {
    // Hiç proje yoksa boş beyaz ekran yerine ne yapılması gerektiğini söyle.
    document.getElementById('sessions').innerHTML = '';
    document.getElementById('cols').innerHTML = `<div class="blank">
      <div>${esc(t('noProjects'))}</div>
      <div class="hint">${esc(t('noProjectsHint'))} <code>crewdesk demo</code></div>
    </div>`;
  }
  office.update(project);
  // Ofis sekmesi de aynı şeyi söylesin: proje yokken boş bir kat planı tek başına
  // hiçbir şey anlatmıyor. Canvas'ın metin alternatifi de buradan besleniyor.
  const officeHint = document.getElementById('officeHint');
  const fallback = document.getElementById('officeFallback');
  if (!project) {
    officeHint.innerHTML = `${esc(t('noProjects'))} <code>crewdesk demo</code>`;
    if (fallback) fallback.textContent = t('noProjects');
  } else {
    officeHint.innerHTML = t('officeHint');
    if (fallback) fallback.textContent = t('officeHint').replace(/<[^>]+>/g, '');
  }
  renderOffline();
  const totalActive = state.projects.reduce((n, p) => n + p.activeCount, 0);
  document.getElementById('footer').textContent = t('footer', state.projects.length, totalActive);
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

// ---- veri ----

let offline = false;

// Sunucu düşünce bayat veri canlıymış gibi görünmesin: üst şeritte son
// güncelleme saatiyle birlikte "bağlantı yok" göstergesi çıkar.
function renderOffline() {
  const el = document.getElementById('offline');
  el.hidden = !offline;
  if (offline) el.innerHTML = esc(`${t('offline')} · ${t('lastUpdate')} ${state ? clock(state.generatedAt) : '—'}`);
}

// Periyodik tazeleme kullanıcının elindeki kontrolü kaçırmasın: odak tahtadaki
// bir düğme ya da açılır listedeyse çizimi bir sonraki tura ertele. Kullanıcı
// eyleminden gelen load() çağrıları (auto=false) hep hemen çizer.
function interacting() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const focusable = el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.hasAttribute('tabindex');
  if (!focusable) return false;
  // Uyarı paneli main'in dışında, body'nin çocuğu; orada da odak kaybolmasın
  // yoksa kapatma düğmesine basılan Enter boşa gidiyor.
  return Boolean(el.closest('main') || el.closest('#alerts'));
}

async function load(auto = false) {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state = await res.json();
  } catch {
    offline = true;
    renderOffline();
    return;
  }
  offline = false;
  renderOffline();
  if (auto && interacting()) return;
  render();
  renderAlerts();
}

// ---- dil ----

function applyStaticStrings() {
  document.documentElement.lang = lang();
  document.getElementById('tabBoard').textContent = t('tabBoard');
  document.getElementById('tabOffice').textContent = t('tabOffice');
  document.getElementById('projectsHeading').textContent = t('projects');
  document.getElementById('officeHint').innerHTML = t('officeHint');
  renderOffline();
}

function mountLanguagePicker() {
  const select = document.getElementById('langSelect');
  select.setAttribute('aria-label', t('langLabel'));
  select.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}"
    ${l.code === lang() ? 'selected' : ''}>${l.label}</option>`).join('');
  select.onchange = () => {
    setLang(select.value);
    document.documentElement.lang = select.value;
    select.setAttribute('aria-label', t('langLabel'));
    applyStaticStrings();
    alertSignature = '';
    office.invalidate?.();
    if (state) { render(); renderAlerts(); }
  };
}

mountLanguagePicker();
applyStaticStrings();

document.getElementById('tabBoard').onclick = () => setView('board');
document.getElementById('tabOffice').onclick = () => setView('office');

// İzin, kullanıcı uyarı panelini kendi açtığında istenir — sayfa açılır açılmaz değil.

load();
setInterval(() => load(true), 4000);
setView(localStorage.getItem('crewdesk:view') || 'board');
