// Pixel office — characters are AGENTS, rooms are what they are doing right now.
// A room is derived from the handoff log, not stored: see src/events.mjs.
// Character sprites: MetroCity free topdown pack by JIK-A-4, CC0.

const PX = 2;
const VW = 640 * PX;
const VH = 356 * PX;
const GAP = 5 * PX;
const WALK_SPEED = 0.05;

const SPRITE_COUNT = 6;
const FRAME_W = 16;
const FRAME_H = 32;

const GRID = [
  ['pm', 'work', 'test'],
  ['handoff', 'waiting', 'lounge'],
];

const ROOM_STYLE = {
  pm: { floor: '#5c4f6b', floor2: '#554963', wall: '#332b40', trim: '#a78bfa' },
  work: { floor: '#4a6470', wall: '#2a3b44', floor2: '#445c68', trim: '#5ec8d8' },
  test: { floor: '#6b6250', wall: '#3f3a2b', floor2: '#645b4a', trim: '#fbbf24' },
  handoff: { floor: '#4d6b56', wall: '#2b4032', floor2: '#476350', trim: '#4ade80' },
  waiting: { floor: '#6b5347', wall: '#402f28', floor2: '#634d42', trim: '#fb923c' },
  lounge: { floor: '#4f4a63', wall: '#2e2a3d', floor2: '#49445c', trim: '#8f89a8' },
};

const AGENT_COLOR = {
  blue: '#5b8ff9', green: '#4ade80', purple: '#a78bfa', orange: '#fb923c',
  red: '#f87171', cyan: '#22d3ee', yellow: '#fbbf24', pink: '#f472b6',
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = Array.from({ length: SPRITE_COUNT }, (_, i) => {
      const img = new Image();
      img.src = `./assets/characters/char_${i}.png`;
      return img;
    });
    this.people = new Map();
    this.labels = {};
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
    this.hover = null;
    for (const p of this.people.values()) {
      if (x > p.x - 4 * PX && x < p.x + 20 * PX && y > p.y - 4 * PX && y < p.y + 36 * PX) this.hover = p;
    }
  }

  roomRect(room) {
    const rowIndex = GRID.findIndex((row) => row.includes(room));
    const colIndex = GRID[rowIndex]?.indexOf(room) ?? 0;
    const w = (VW - GAP * 4) / 3;
    const h = (VH - GAP * 3) / 2;
    return { x: GAP + colIndex * (w + GAP), y: GAP + rowIndex * (h + GAP), w, h };
  }

  seat(room, index) {
    const rect = this.roomRect(room);
    const cellW = 34 * PX;
    const cellH = 46 * PX;
    const perRow = Math.max(1, Math.floor((rect.w - 8 * PX) / cellW));
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    return {
      x: rect.x + 13 * PX + col * cellW,
      y: rect.y + 34 * PX + row * cellH,
    };
  }

  update(project, roomLabels) {
    if (roomLabels) this.labels = roomLabels;
    const crew = project?.crew || [];
    const perRoom = {};
    const seen = new Set();

    for (const member of crew) {
      perRoom[member.room] = (perRoom[member.room] || 0) + 1;
      const target = this.seat(member.room, perRoom[member.room] - 1);
      seen.add(member.name);

      let person = this.people.get(member.name);
      if (!person) {
        person = {
          name: member.name,
          x: target.x,
          y: target.y,
          sprite: hash(member.name) % SPRITE_COUNT,
          phase: hash(member.name) % 120,
        };
        this.people.set(member.name, person);
      }
      person.tx = target.x;
      person.ty = target.y;
      Object.assign(person, {
        room: member.room,
        queue: member.queue,
        active: member.active,
        waiting: member.waiting,
        color: member.color,
        task: member.currentTask,
        rounds: member.testRounds,
        description: member.description,
      });
    }

    for (const name of [...this.people.keys()]) if (!seen.has(name)) this.people.delete(name);
    this.roomCounts = perRoom;
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

  p(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  drawDesk(x, y, tint) {
    this.p(x, y + 9 * PX, 26 * PX, 2 * PX, 'rgba(0,0,0,0.30)');
    this.p(x, y, 26 * PX, 9 * PX, '#8a6440');
    this.p(x, y, 26 * PX, 2 * PX, '#a67c4e');
    this.p(x + 1 * PX, y + 9 * PX, 2 * PX, 4 * PX, '#6b4c30');
    this.p(x + 23 * PX, y + 9 * PX, 2 * PX, 4 * PX, '#6b4c30');
    this.p(x + 8 * PX, y - 9 * PX, 11 * PX, 9 * PX, '#3c4250');
    this.p(x + 9 * PX, y - 8 * PX, 9 * PX, 6 * PX, tint);
    this.p(x + 9 * PX, y - 8 * PX, 9 * PX, 2 * PX, 'rgba(255,255,255,0.22)');
    this.p(x + 12 * PX, y, 3 * PX, 2 * PX, '#2f3441');
    this.p(x + 21 * PX, y + 3 * PX, 3 * PX, 3 * PX, '#d9673f');
  }

  drawCouch(x, y) {
    this.p(x, y, 30 * PX, 12 * PX, '#7d4a52');
    this.p(x, y - 5 * PX, 30 * PX, 6 * PX, '#8d565e');
    this.p(x + 2 * PX, y + 1 * PX, 12 * PX, 8 * PX, 'rgba(255,255,255,0.08)');
  }

  drawShelf(x, y) {
    this.p(x, y, 26 * PX, 4 * PX, '#5b4a3a');
    for (let i = 0; i < 6; i++) {
      this.p(x + 2 * PX + i * 4 * PX, y - 6 * PX, 3 * PX, 6 * PX, i % 3 ? '#7d5a86' : '#5a7d86');
    }
  }

  drawPerson(p, walking) {
    const img = this.sprites[p.sprite % SPRITE_COUNT];
    const bob = walking ? 0 : Math.round(Math.sin((this.tick + p.phase) * 0.05)) * PX;
    const x = p.x;
    const y = p.y + bob;

    if (p.active) {
      this.ctx.fillStyle = 'rgba(74,222,128,0.18)';
      this.ctx.beginPath();
      this.ctx.ellipse(x + 8 * PX, y + 30 * PX, 14 * PX, 5 * PX, 0, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.fillStyle = 'rgba(0,0,0,0.30)';
    this.ctx.beginPath();
    this.ctx.ellipse(x + 8 * PX, y + 31 * PX, 6 * PX, 2.5 * PX, 0, 0, Math.PI * 2);
    this.ctx.fill();

    if (!img?.complete || img.naturalWidth === 0) {
      this.p(x + 3 * PX, y + 10 * PX, 10 * PX, 20 * PX, '#5b5570');
      return;
    }
    const col = walking ? 1 + Math.floor((this.tick / 5 + p.phase) % 6) : 0;
    const row = walking ? 0 : (p.room === 'work' || p.room === 'test' ? 2 : 0);
    this.ctx.drawImage(img, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H,
      Math.round(x), Math.round(y), FRAME_W * PX, FRAME_H * PX);
  }

  tag(cx, y, text, bg, fg) {
    const ctx = this.ctx;
    ctx.font = `${7 * PX}px ui-monospace, Menlo, monospace`;
    const w = ctx.measureText(text).width + 6 * PX;
    const x = cx - w / 2;
    this.p(x, y, w, 10 * PX, bg);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, y + 7.5 * PX);
  }

  drawRoom(room) {
    const ctx = this.ctx;
    const rect = this.roomRect(room);
    const style = ROOM_STYLE[room];

    for (let y = rect.y; y < rect.y + rect.h; y += 8 * PX) {
      for (let x = rect.x; x < rect.x + rect.w; x += 8 * PX) {
        const alt = (Math.round((x - rect.x) / (8 * PX)) + Math.round((y - rect.y) / (8 * PX))) % 2;
        this.p(x, y, 8 * PX, 8 * PX, alt ? style.floor : style.floor2);
      }
    }

    this.p(rect.x, rect.y, rect.w, 20 * PX, style.wall);
    this.p(rect.x, rect.y + 20 * PX, rect.w, 2 * PX, 'rgba(0,0,0,0.45)');
    this.p(rect.x, rect.y + 17 * PX, rect.w, 3 * PX, 'rgba(255,255,255,0.06)');

    if (room === 'lounge') {
      this.drawCouch(rect.x + rect.w - 40 * PX, rect.y + rect.h - 24 * PX);
      this.p(rect.x + 8 * PX, rect.y + rect.h - 20 * PX, 10 * PX, 10 * PX, '#6b4c30');
    } else if (room === 'handoff') {
      for (let i = 0; i < 3; i++) {
        this.p(rect.x + 10 * PX + i * 14 * PX, rect.y + rect.h - 20 * PX, 11 * PX, 8 * PX, '#c8b088');
        this.p(rect.x + 10 * PX + i * 14 * PX, rect.y + rect.h - 22 * PX, 11 * PX, 3 * PX, '#e0cba4');
      }
    } else if (room === 'waiting') {
      this.p(rect.x + 10 * PX, rect.y + rect.h - 22 * PX, 24 * PX, 10 * PX, '#8d565e');
      this.p(rect.x + 10 * PX, rect.y + rect.h - 27 * PX, 24 * PX, 6 * PX, '#9c626b');
    } else if (room === 'pm') {
      this.drawShelf(rect.x + rect.w - 34 * PX, rect.y + 14 * PX);
    }

    const px0 = rect.x + rect.w - 14 * PX;
    const py0 = rect.y + rect.h - 16 * PX;
    this.p(px0, py0, 8 * PX, 8 * PX, '#8a5f3c');
    this.p(px0 - 2 * PX, py0 - 8 * PX, 12 * PX, 8 * PX, '#4c8a55');

    ctx.font = `bold ${8 * PX}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = style.trim;
    ctx.textAlign = 'left';
    ctx.fillText(this.labels[room] || room.toUpperCase(), rect.x + 5 * PX, rect.y + 13 * PX);

    const count = this.roomCounts?.[room] || 0;
    ctx.textAlign = 'right';
    ctx.fillStyle = count ? '#efedf6' : 'rgba(255,255,255,0.25)';
    ctx.fillText(String(count), rect.x + rect.w - 5 * PX, rect.y + 13 * PX);
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

    for (const row of GRID) for (const room of row) this.drawRoom(room);

    const ordered = [...this.people.values()].sort((a, b) => a.y - b.y);
    for (const p of ordered) {
      const dx = (p.tx ?? p.x) - p.x;
      const dy = (p.ty ?? p.y) - p.y;
      const walking = Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5;
      if (walking) {
        p.x += dx * WALK_SPEED;
        p.y += dy * WALK_SPEED;
      }

      const style = ROOM_STYLE[p.room] || ROOM_STYLE.work;
      if (!walking && (p.room === 'work' || p.room === 'test' || p.room === 'pm')) {
        this.drawDesk(p.x - 5 * PX, p.y - 2 * PX, style.trim);
      }
      this.drawPerson(p, walking);

      // taşıdığı iş
      if (p.task && !walking) {
        const label = `#${p.task.id}`;
        this.tag(p.x + 8 * PX, p.y - 16 * PX, label, 'rgba(16,15,22,0.9)', '#e8e6f0');
      }

      // adı + kuyruk sayısı
      ctx.font = `${7 * PX}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.waiting ? '#fb923c' : p.active ? '#4ade80' : '#b9b3cc';
      const short = p.name
        .replace(/-specialist$/, '').replace(/-reviewer$/, '')
        .replace(/-manager$/, '-mgr').replace(/-designer$/, '-ux');
      ctx.fillText(short.length > 12 ? short.slice(0, 11) + '…' : short, p.x + 8 * PX, p.y + 38 * PX);

      if (p.color && AGENT_COLOR[p.color]) {
        this.p(p.x + 1 * PX, p.y + 40 * PX, 14 * PX, 2 * PX, AGENT_COLOR[p.color]);
      }
      if (p.queue > 0) {
        this.tag(p.x + 20 * PX, p.y - 2 * PX, String(p.queue), '#7c3aed', '#ffffff');
      }
      if (p.rounds > 0) {
        this.tag(p.x - 4 * PX, p.y - 2 * PX, `↺${p.rounds}`, '#7f1d1d', '#fecaca');
      }
    }

    if (this.hover) {
      const text = this.hover.task
        ? `${this.hover.name}: #${this.hover.task.id} ${this.hover.task.subject}`
        : `${this.hover.name}: kuyruk boş`;
      const ctx2 = this.ctx;
      ctx2.font = `${8 * PX}px ui-monospace, Menlo, monospace`;
      const label = text.length > 64 ? text.slice(0, 63) + '…' : text;
      const w = ctx2.measureText(label).width + 10 * PX;
      const bx = Math.max(GAP, Math.min(VW - w - GAP, this.hover.x - w / 2));
      const by = Math.max(14 * PX, this.hover.y - 28 * PX);
      this.p(bx, by, w, 13 * PX, 'rgba(12,11,18,0.95)');
      this.p(bx, by, 2 * PX, 13 * PX, '#8b7dfa');
      ctx2.fillStyle = '#e8e6f0';
      ctx2.textAlign = 'left';
      ctx2.fillText(label, bx + 5 * PX, by + 9.5 * PX);
    }
  }
}
