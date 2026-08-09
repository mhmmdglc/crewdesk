// Pixel office view — rooms are pipeline stages, every work item gets a desk.
// Drawn procedurally on a chunky pixel grid: no external sprite assets, no licence baggage.

const PX = 2;                 // one "pixel" of art = 2 canvas px
const VW = 640 * PX;
const VH = 296 * PX;
const LOBBY_H = 78 * PX;
const GAP = 5 * PX;
const WALK_SPEED = 0.06;

const STAGE_LABEL = { manager: 'MANAGER', dev: 'GELİŞTİRME', test: 'TEST', done: 'BİTTİ' };
const ROOM = {
  manager: { floor: '#6b5a72', floor2: '#63536a', wall: '#3a2f44', trim: '#8b7dfa', rug: '#7d5f86' },
  dev: { floor: '#4f6670', floor2: '#495e68', wall: '#2b3c44', trim: '#5ec8d8', rug: '#4a6d78' },
  test: { floor: '#6f6450', floor2: '#675d4a', wall: '#413a2b', trim: '#fbbf24', rug: '#7a6a4a' },
  done: { floor: '#4f6b56', floor2: '#496350', wall: '#2b4032', trim: '#4ade80', rug: '#4a705a' },
};

// Character sprites: MetroCity free topdown pack by JIK-A-4, CC0.
// Sheet 112x96 = 7 columns (col 0 idle, 1-6 walk) x 3 rows (down / side / up), 16x32 per frame.
const SPRITE_COUNT = 6;
const FRAME_W = 16;
const FRAME_H = 32;
const AGENT_COLOR = {
  blue: '#5b8ff9', green: '#4ade80', purple: '#a78bfa', orange: '#fb923c',
  red: '#f87171', cyan: '#22d3ee', yellow: '#fbbf24', pink: '#f472b6',
};

function loadSprites() {
  return Array.from({ length: SPRITE_COUNT }, (_, i) => {
    const img = new Image();
    img.src = `./assets/characters/char_${i}.png`;
    return img;
  });
}

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
    this.roster = [];
    this.sprites = loadSprites();
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
      if (Math.abs(p.x + 11 * PX - x) < 14 * PX && y > p.y - 6 * PX && y < p.y + 30 * PX) found = p;
    }
    this.hover = found;
  }

  roomRect(stage) {
    const index = this.stages.indexOf(stage);
    const w = (VW - GAP * (this.stages.length + 1)) / this.stages.length;
    return { x: GAP + index * (w + GAP), y: LOBBY_H + GAP, w, h: VH - LOBBY_H - GAP * 2 };
  }

  seat(stage, index) {
    const room = this.roomRect(stage);
    const cellW = 32 * PX;
    const cellH = 46 * PX;
    const perRow = Math.max(1, Math.floor((room.w - 8 * PX) / cellW));
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    const usedW = perRow * cellW;
    return {
      x: room.x + (room.w - usedW) / 2 + col * cellW + 4 * PX,
      y: room.y + 34 * PX + row * cellH,
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
      const target = this.seat(task.stage, perStage[task.stage] - 1);
      seen.add(task.key);

      let person = this.people.get(task.key);
      if (!person) {
        const seed = hash(task.key);
        person = {
          key: task.key,
          x: target.x,
          y: target.y,
          sprite: seed % SPRITE_COUNT,
          phase: seed % 120,
        };
        this.people.set(task.key, person);
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

    this.roster = (project?.roster || []).map((agent) => ({
      ...agent,
      sprite: hash(agent.name) % SPRITE_COUNT,
      phase: hash(agent.name) % 120,
    }));

    this.agents = (project?.sessions || []).flatMap((s) => [
      { name: s.title || s.sessionId.slice(0, 8), tool: s.lastTool, status: s.status, seed: hash(s.sessionId), sub: false },
      ...s.subagents.map((a) => ({
        name: a.name, tool: a.lastTool, status: s.status, seed: hash(s.sessionId + a.name), sub: true,
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

  stop() { this.running = false; }

  // ---- primitives ----

  p(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  // ---- furniture ----

  drawDesk(x, y, tint) {
    this.p(x, y + 9 * PX, 26 * PX, 2 * PX, 'rgba(0,0,0,0.30)');   // shadow
    this.p(x, y, 26 * PX, 9 * PX, '#8a6440');                      // desk top
    this.p(x, y, 26 * PX, 2 * PX, '#a67c4e');                      // highlight
    this.p(x + 1 * PX, y + 9 * PX, 2 * PX, 4 * PX, '#6b4c30');     // legs
    this.p(x + 23 * PX, y + 9 * PX, 2 * PX, 4 * PX, '#6b4c30');

    this.p(x + 8 * PX, y - 9 * PX, 11 * PX, 9 * PX, '#3c4250');    // monitor body
    this.p(x + 9 * PX, y - 8 * PX, 9 * PX, 6 * PX, tint);          // screen
    this.p(x + 9 * PX, y - 8 * PX, 9 * PX, 2 * PX, 'rgba(255,255,255,0.22)');
    this.p(x + 12 * PX, y, 3 * PX, 2 * PX, '#2f3441');             // stand

    this.p(x + 2 * PX, y + 2 * PX, 5 * PX, 3 * PX, '#c9cfdb');     // keyboard
    this.p(x + 21 * PX, y + 3 * PX, 3 * PX, 3 * PX, '#d9673f');    // mug
  }

  drawChair(x, y) {
    this.p(x + 6 * PX, y + 4 * PX, 13 * PX, 4 * PX, '#2f5f3d');
    this.p(x + 6 * PX, y, 13 * PX, 5 * PX, '#3a7a4c');
    this.p(x + 11 * PX, y + 8 * PX, 3 * PX, 4 * PX, '#26332c');
  }

  drawPerson(p, seated, walking, glow) {
    const img = this.sprites[p.sprite % SPRITE_COUNT];
    const x = p.x;
    const bob = seated ? Math.round(Math.sin((this.tick + p.phase) * 0.05)) * PX : 0;
    const y = p.y + bob;

    if (glow) {
      this.ctx.fillStyle = 'rgba(74,222,128,0.16)';
      this.ctx.beginPath();
      this.ctx.ellipse(x + 8 * PX, y + 30 * PX, 15 * PX, 6 * PX, 0, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.fillStyle = 'rgba(0,0,0,0.28)';
    this.ctx.beginPath();
    this.ctx.ellipse(x + 8 * PX, y + 31 * PX, 6 * PX, 2.5 * PX, 0, 0, Math.PI * 2);
    this.ctx.fill();

    if (!img?.complete || img.naturalWidth === 0) {
      this.p(x + 3 * PX, y + 10 * PX, 10 * PX, 20 * PX, '#5b5570');
      return;
    }

    const col = walking ? 1 + Math.floor((this.tick / 5 + p.phase) % 6) : 0;
    const row = walking ? 0 : 2; // yürürken bize dönük, otururken monitöre dönük (sırtı)
    this.ctx.drawImage(
      img,
      col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H,
      Math.round(x), Math.round(y), FRAME_W * PX, FRAME_H * PX,
    );
  }

  bubble(cx, y, text, accent = '#8b7dfa') {
    const ctx = this.ctx;
    ctx.font = `${9 * PX}px ui-monospace, Menlo, monospace`;
    const label = text.length > 30 ? text.slice(0, 29) + '…' : text;
    const w = ctx.measureText(label).width + 10 * PX;
    const bx = Math.max(GAP, Math.min(VW - w - GAP, cx - w / 2));
    this.p(bx, y - 15 * PX, w, 13 * PX, 'rgba(16,15,22,0.94)');
    this.p(bx, y - 15 * PX, 2 * PX, 13 * PX, accent);
    this.p(bx + w / 2 - 2 * PX, y - 2 * PX, 4 * PX, 2 * PX, 'rgba(16,15,22,0.94)');
    ctx.fillStyle = '#e8e6f0';
    ctx.textAlign = 'left';
    ctx.fillText(label, bx + 5 * PX, y - 5 * PX);
  }

  // ---- rooms ----

  drawLobby() {
    const ctx = this.ctx;
    const w = VW - GAP * 2;
    this.p(GAP, GAP, w, LOBBY_H - GAP, '#241f2e');
    this.p(GAP, GAP, w, 22 * PX, '#1b1724');
    this.p(GAP, GAP + 22 * PX, w, 1 * PX, 'rgba(0,0,0,0.5)');

    // back wall dressing: window + clock + shelf
    this.p(GAP + w - 60 * PX, GAP + 4 * PX, 26 * PX, 14 * PX, '#3d5670');
    this.p(GAP + w - 59 * PX, GAP + 5 * PX, 24 * PX, 12 * PX, '#5b86ad');
    this.p(GAP + w - 47 * PX, GAP + 5 * PX, 1 * PX, 12 * PX, '#3d5670');
    this.p(GAP + w - 78 * PX, GAP + 7 * PX, 8 * PX, 8 * PX, '#d9d3e6');
    this.p(GAP + w - 75 * PX, GAP + 9 * PX, 1 * PX, 4 * PX, '#3a3550');
    this.p(GAP + 100 * PX, GAP + 6 * PX, 34 * PX, 3 * PX, '#5b4a3a');
    for (let i = 0; i < 8; i++) {
      this.p(GAP + 102 * PX + i * 4 * PX, GAP + 1 * PX, 3 * PX, 5 * PX, i % 3 ? '#7d5a86' : '#5a7d86');
    }

    ctx.font = `bold ${8 * PX}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#a9a3bd';
    ctx.textAlign = 'left';
    const heading = this.roster.length ? 'TAKIM' : 'CANLI OTURUMLAR';
    ctx.fillText(heading, GAP + 6 * PX, GAP + 15 * PX);

    // Projenin kendi ajan kadrosu varsa onu göster; yoksa canlı oturumlara düş
    const crew = this.roster.length
      ? this.roster.map((a) => ({
        name: a.name, sprite: a.sprite, phase: a.phase, color: a.color,
        active: a.active, load: a.load, tool: null,
      }))
      : this.agents.map((a) => ({
        name: a.name, sprite: a.seed % SPRITE_COUNT, phase: a.seed % 120,
        color: null, active: a.status === 'active', load: 0, tool: a.tool,
      }));

    // canlı oturumun çalıştırdığı tool'u, adı eşleşen ajana iliştir
    for (const agent of this.agents) {
      if (!agent.tool || agent.status !== 'active') continue;
      const match = crew.find((c) => c.name === agent.name) || crew[0];
      if (match) { match.tool = agent.tool; match.active = true; }
    }

    if (crew.length === 0) {
      ctx.font = `${8 * PX}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = '#6b6680';
      ctx.fillText('bu projede tanımlı ajan ve açık oturum yok', GAP + 6 * PX, GAP + 40 * PX);
      return;
    }

    const slot = Math.min(64 * PX, (VW - GAP * 4) / crew.length);
    crew.slice(0, 9).forEach((member, i) => {
      const x = GAP + 12 * PX + i * slot;
      const y = GAP + 22 * PX;
      this.drawPerson({ x, y, sprite: member.sprite, phase: member.phase }, false, member.active, member.active);
      if (member.tool) this.bubble(x + 8 * PX, y - 2 * PX, member.tool, '#4ade80');

      ctx.font = `${7 * PX}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = member.active ? '#4ade80' : '#8c86a3';
      const short = member.name
        .replace(/-specialist$/, '')
        .replace(/-reviewer$/, '')
        .replace(/-manager$/, '-mgr')
        .replace(/-designer$/, '-ux');
      ctx.fillText(short.length > 13 ? short.slice(0, 12) + '…' : short, x + 8 * PX, y + 42 * PX);

      if (member.color && AGENT_COLOR[member.color]) {
        this.p(x + 1 * PX, y + 45 * PX, 14 * PX, 2 * PX, AGENT_COLOR[member.color]);
      }
      if (member.load) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`${member.load} iş`, x + 8 * PX, y + 54 * PX);
      }
    });
  }

  drawRoom(stage) {
    const ctx = this.ctx;
    const room = this.roomRect(stage);
    const tint = ROOM[stage] || ROOM.manager;

    // checkerboard floor
    for (let y = room.y; y < room.y + room.h; y += 8 * PX) {
      for (let x = room.x; x < room.x + room.w; x += 8 * PX) {
        const alt = (Math.round((x - room.x) / (8 * PX)) + Math.round((y - room.y) / (8 * PX))) % 2;
        this.p(x, y, 8 * PX, 8 * PX, alt ? tint.floor : tint.floor2);
      }
    }

    // rug
    this.p(room.x + 10 * PX, room.y + room.h - 34 * PX, room.w - 20 * PX, 24 * PX, tint.rug);
    this.p(room.x + 13 * PX, room.y + room.h - 31 * PX, room.w - 26 * PX, 18 * PX, 'rgba(255,255,255,0.05)');

    // back wall + baseboard
    this.p(room.x, room.y, room.w, 20 * PX, tint.wall);
    this.p(room.x, room.y + 20 * PX, room.w, 2 * PX, 'rgba(0,0,0,0.45)');
    this.p(room.x, room.y + 17 * PX, room.w, 3 * PX, 'rgba(255,255,255,0.06)');

    // framed pictures on the wall, kept clear of the label and the counter
    for (let i = 0; i < 2; i++) {
      const fx = room.x + room.w / 2 - 16 * PX + i * 20 * PX;
      this.p(fx, room.y + 5 * PX, 12 * PX, 9 * PX, '#4a3b2e');
      this.p(fx + 2 * PX, room.y + 7 * PX, 8 * PX, 5 * PX, i ? tint.trim : '#8496b5');
    }

    // plant
    const px0 = room.x + room.w - 16 * PX;
    const py0 = room.y + room.h - 20 * PX;
    this.p(px0, py0, 8 * PX, 8 * PX, '#8a5f3c');
    this.p(px0 - 1 * PX, py0 - 1 * PX, 10 * PX, 2 * PX, '#a3714a');
    this.p(px0 - 2 * PX, py0 - 9 * PX, 12 * PX, 8 * PX, '#4c8a55');
    this.p(px0 + 1 * PX, py0 - 13 * PX, 6 * PX, 5 * PX, '#5aa365');

    // water cooler
    this.p(room.x + 6 * PX, room.y + room.h - 22 * PX, 7 * PX, 12 * PX, '#cfd6e4');
    this.p(room.x + 6 * PX, room.y + room.h - 28 * PX, 7 * PX, 7 * PX, '#7fb6d9');

    ctx.font = `bold ${8 * PX}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = tint.trim;
    ctx.textAlign = 'left';
    ctx.fillText(STAGE_LABEL[stage] || stage.toUpperCase(), room.x + 5 * PX, room.y + 13 * PX);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#efedf6';
    ctx.fillText(String(this.counts[stage] || 0), room.x + room.w - 5 * PX, room.y + 13 * PX);

    if (!this.counts[stage]) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.font = `${8 * PX}px ui-monospace, Menlo, monospace`;
      ctx.fillText('boş', room.x + room.w / 2, room.y + room.h / 2);
    }
  }

  draw() {
    const ctx = this.ctx;
    this.tick += 1;
    if (this.canvas.width !== VW) {
      this.canvas.width = VW;
      this.canvas.height = VH;
    }
    ctx.imageSmoothingEnabled = false;

    this.p(0, 0, VW, VH, '#14131a');
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

      const tint = ROOM[p.stage] || ROOM.manager;
      if (walking) {
        this.drawPerson(p, false, true, p.busy);
      } else {
        // masa yukarıda, sandalye ve karakter altında: karakter monitöre dönük oturuyor
        this.drawDesk(p.x - 5 * PX, p.y - 2 * PX, tint.trim);
        this.drawChair(p.x, p.y + 16 * PX);
        this.drawPerson(p, true, false, p.busy);
      }

      ctx.font = `${7 * PX}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.rounds ? '#f87171' : '#cfcade';
      const tag = p.rounds ? `${p.label} ↺${p.rounds}` : p.label;
      ctx.fillText(tag.length > 11 ? tag.slice(0, 10) + '…' : tag, p.x + 8 * PX, p.y + 37 * PX);
    }

    if (this.hover) this.bubble(this.hover.x + 11 * PX, this.hover.y - 12 * PX, this.hover.title);
  }
}
