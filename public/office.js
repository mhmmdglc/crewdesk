// Pixel office view — rooms are pipeline stages, characters are work items.
// Everything is drawn procedurally: no external sprite assets, no licence baggage.

const VW = 1280;
const VH = 560;
const LOBBY_H = 150;
const ROOM_GAP = 10;
const WALK_SPEED = 0.055;

const STAGE_LABEL = { manager: 'MANAGER', dev: 'GELİŞTİRME', test: 'TEST', done: 'BİTTİ' };
const ROOM_TINT = {
  manager: { floor: '#4a3b52', wall: '#2c2333', accent: '#8b7dfa' },
  dev: { floor: '#3b4a52', wall: '#232f33', accent: '#5ec8d8' },
  test: { floor: '#52493b', wall: '#332e23', accent: '#fbbf24' },
  done: { floor: '#3b5240', wall: '#233326', accent: '#4ade80' },
};

const SHIRTS = ['#e2604f', '#5ec8d8', '#8b7dfa', '#4ade80', '#fbbf24', '#f472b6', '#93b4f8', '#fb923c'];
const SKIN = ['#f0c8a0', '#d9a276', '#b57b52', '#8d5a3b', '#f7dcc0'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.people = new Map();
    this.agents = [];
    this.stages = ['manager', 'dev', 'test', 'done'];
    this.counts = {};
    this.tick = 0;
    this.running = false;
    this.hover = null;
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; });
  }

  onMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VW;
    const y = ((event.clientY - rect.top) / rect.height) * VH;
    let found = null;
    for (const p of this.people.values()) {
      if (Math.abs(p.x - x) < 16 && y > p.y - 34 && y < p.y + 8) found = p;
    }
    this.hover = found;
  }

  roomRect(stage) {
    const index = this.stages.indexOf(stage);
    const width = (VW - ROOM_GAP * (this.stages.length + 1)) / this.stages.length;
    return {
      x: ROOM_GAP + index * (width + ROOM_GAP),
      y: LOBBY_H + ROOM_GAP,
      w: width,
      h: VH - LOBBY_H - ROOM_GAP * 2,
    };
  }

  seat(stage, index) {
    const room = this.roomRect(stage);
    const perRow = Math.max(2, Math.floor((room.w - 40) / 54));
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    return {
      x: room.x + 34 + col * 54 + (row % 2 ? 12 : 0),
      y: room.y + 96 + row * 62,
    };
  }

  update(project, stages) {
    if (stages?.length) this.stages = stages;
    const tasks = project?.tasks || [];
    this.counts = {};
    const seen = new Set();
    const perStage = {};

    for (const task of tasks) {
      this.counts[task.stage] = (this.counts[task.stage] || 0) + 1;
      perStage[task.stage] = (perStage[task.stage] || 0) + 1;
      const index = perStage[task.stage] - 1;
      const target = this.seat(task.stage, index);
      const key = task.key;
      seen.add(key);

      let person = this.people.get(key);
      if (!person) {
        const seed = hash(key);
        person = {
          key,
          x: target.x,
          y: target.y,
          shirt: SHIRTS[seed % SHIRTS.length],
          skin: SKIN[(seed >> 3) % SKIN.length],
          phase: seed % 100,
        };
        this.people.set(key, person);
      }
      person.tx = target.x;
      person.ty = target.y;
      person.stage = task.stage;
      person.label = task.owner || `#${task.id}`;
      person.title = task.subject;
      person.rounds = task.testRounds || 0;
      person.busy = task.status === 'in_progress';
    }

    for (const key of [...this.people.keys()]) if (!seen.has(key)) this.people.delete(key);

    this.agents = (project?.sessions || []).flatMap((s) => [
      {
        name: s.title || s.sessionId.slice(0, 8),
        tool: s.lastTool,
        status: s.status,
        seed: hash(s.sessionId),
        sub: false,
      },
      ...s.subagents.map((a) => ({
        name: a.name,
        tool: a.lastTool,
        status: s.status,
        seed: hash(s.sessionId + a.name),
        sub: true,
      })),
    ]);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
  }

  // ---- drawing ----

  px(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  drawPerson(p, walking, glow) {
    const bob = walking ? Math.round(Math.sin((this.tick + p.phase) * 0.3)) : Math.round(Math.sin((this.tick + p.phase) * 0.06));
    const x = p.x;
    const y = p.y + bob;

    if (glow) {
      this.ctx.fillStyle = 'rgba(74,222,128,0.16)';
      this.ctx.beginPath();
      this.ctx.arc(x + 6, y - 8, 20, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.px(x - 1, y + 12, 15, 3, 'rgba(0,0,0,0.28)');   // shadow
    this.px(x + 1, y + 4, 4, 9, '#2b2438');               // legs
    this.px(x + 8, y + 4, 4, 9, '#2b2438');
    this.px(x, y - 6, 13, 11, p.shirt);                   // torso
    this.px(x - 3, y - 4, 3, 8, p.shirt);                 // arms
    this.px(x + 13, y - 4, 3, 8, p.shirt);
    this.px(x + 1, y - 17, 11, 11, p.skin);               // head
    this.px(x + 1, y - 18, 11, 4, '#33283f');             // hair
    const blink = Math.sin((this.tick + p.phase) * 0.05) > 0.97;
    if (!blink) {
      this.px(x + 3, y - 12, 2, 2, '#1a1520');
      this.px(x + 8, y - 12, 2, 2, '#1a1520');
    }
  }

  bubble(x, y, text, accent = '#8b7dfa') {
    const ctx = this.ctx;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    const w = Math.min(230, ctx.measureText(text).width + 16);
    const bx = Math.max(6, Math.min(VW - w - 6, x - w / 2));
    ctx.fillStyle = 'rgba(20,19,26,0.92)';
    ctx.fillRect(bx, y - 20, w, 18);
    ctx.fillStyle = accent;
    ctx.fillRect(bx, y - 20, 2, 18);
    ctx.fillStyle = '#e8e6f0';
    ctx.textAlign = 'left';
    ctx.fillText(text.length > 34 ? text.slice(0, 33) + '…' : text, bx + 8, y - 7);
  }

  drawLobby() {
    const ctx = this.ctx;
    this.px(ROOM_GAP, ROOM_GAP, VW - ROOM_GAP * 2, LOBBY_H - ROOM_GAP, '#1c1b24');
    this.px(ROOM_GAP, ROOM_GAP, VW - ROOM_GAP * 2, 2, '#302e3c');

    for (let i = 0; i < 5; i++) {
      this.px(VW - 40 - i * 26, ROOM_GAP + 10, 16, 20, i % 2 ? '#2a2735' : '#262331');
    }

    ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#9d99b0';
    ctx.textAlign = 'left';
    ctx.fillText('CANLI AJANLAR', 22, ROOM_GAP + 24);

    if (this.agents.length === 0) {
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillStyle = '#5d5970';
      ctx.fillText('bu projede şu an çalışan oturum yok', 22, ROOM_GAP + 48);
      return;
    }

    this.agents.slice(0, 8).forEach((agent, i) => {
      const x = 84 + i * 150;
      const y = LOBBY_H - 42;
      const person = {
        x,
        y,
        shirt: SHIRTS[agent.seed % SHIRTS.length],
        skin: SKIN[(agent.seed >> 3) % SKIN.length],
        phase: agent.seed % 100,
      };
      const active = agent.status === 'active';
      this.drawPerson(person, active, active);
      if (agent.tool && active) this.bubble(x + 6, y - 20, agent.tool, '#4ade80');

      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.fillStyle = agent.status === 'waiting' ? '#fbbf24' : active ? '#4ade80' : '#7c788d';
      ctx.textAlign = 'center';
      const name = agent.sub ? '└ ' + agent.name : agent.name;
      ctx.fillText(name.length > 18 ? name.slice(0, 17) + '…' : name, x + 6, y + 28);
    });
  }

  drawRoom(stage) {
    const ctx = this.ctx;
    const room = this.roomRect(stage);
    const tint = ROOM_TINT[stage] || ROOM_TINT.manager;

    this.px(room.x, room.y, room.w, room.h, tint.floor);
    this.px(room.x, room.y, room.w, 46, tint.wall);
    this.px(room.x, room.y + 46, room.w, 2, 'rgba(0,0,0,0.35)');

    for (let y = room.y + 48; y < room.y + room.h; y += 24) {
      this.px(room.x, y, room.w, 1, 'rgba(0,0,0,0.10)');
    }

    // desks along the back wall
    for (let i = 0; i < Math.floor(room.w / 90); i++) {
      const dx = room.x + 22 + i * 90;
      this.px(dx, room.y + 52, 56, 16, '#6b4f3a');
      this.px(dx + 14, room.y + 42, 26, 12, '#cfd6e4');
      this.px(dx + 16, room.y + 44, 22, 8, tint.accent);
    }

    // plant in the corner
    this.px(room.x + room.w - 26, room.y + room.h - 34, 12, 14, '#7a5a3c');
    this.px(room.x + room.w - 30, room.y + room.h - 46, 20, 14, '#4a8a52');

    ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
    ctx.fillStyle = tint.accent;
    ctx.textAlign = 'left';
    ctx.fillText(STAGE_LABEL[stage] || stage.toUpperCase(), room.x + 14, room.y + 26);

    const count = this.counts[stage] || 0;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8e6f0';
    ctx.fillText(String(count), room.x + room.w - 14, room.y + 26);

    if (count === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillText('boş', room.x + room.w / 2, room.y + room.h / 2);
    }
  }

  draw() {
    const ctx = this.ctx;
    this.tick += 1;
    this.canvas.width = VW;
    this.canvas.height = VH;
    ctx.imageSmoothingEnabled = false;

    this.px(0, 0, VW, VH, '#14131a');
    this.drawLobby();
    for (const stage of this.stages) this.drawRoom(stage);

    const ordered = [...this.people.values()].sort((a, b) => a.y - b.y);
    for (const p of ordered) {
      const dx = (p.tx ?? p.x) - p.x;
      const dy = (p.ty ?? p.y) - p.y;
      const walking = Math.abs(dx) > 1 || Math.abs(dy) > 1;
      if (walking) {
        p.x += dx * WALK_SPEED;
        p.y += dy * WALK_SPEED;
      }
      this.drawPerson(p, walking, p.busy);

      ctx.font = '9px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.rounds ? '#f87171' : '#9d99b0';
      const tag = p.rounds ? `${p.label} ↺${p.rounds}` : p.label;
      ctx.fillText(tag.length > 15 ? tag.slice(0, 14) + '…' : tag, p.x + 6, p.y + 26);
    }

    if (this.hover) this.bubble(this.hover.x + 6, this.hover.y - 22, this.hover.title);
  }
}
