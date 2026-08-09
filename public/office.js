// Pixel office — characters are AGENTS and SESSIONS, rooms are what each is doing right now.
// Room membership is derived from the handoff log + live transcript activity (src/events.mjs).
//
// Art: character sprites CC0 (MetroCity, JIK-A-4). Furniture/floor/carpet sprites MIT
// (Pixel Agents, Pablo De Lucca) — see LICENSE-THIRD-PARTY.

const PX = 2;
const VW = 660 * PX;
const VH = 380 * PX;
const GAP = 5 * PX;
const WALK_SPEED = 0.05;
const WALL_H = 26 * PX;

const SPRITE_COUNT = 6;
const FRAME_W = 16;
const FRAME_H = 32;

const GRID = [
  ['pm', 'work', 'test'],
  ['handoff', 'waiting', 'lounge'],
];

// Zemin ve halı tile'ları gri maskedir; oda rengi multiply ile üstüne basılır.
const ROOM_STYLE = {
  pm: { floor: 'floor_3', tint: '#8f7bb5', wall: '#3a2f48', trim: '#a78bfa', carpet: 'carpet_0', carpetTint: '#7a5f9c' },
  work: { floor: 'floor_1', tint: '#7fa6b8', wall: '#263a44', trim: '#5ec8d8', carpet: null },
  test: { floor: 'floor_5', tint: '#b8a877', wall: '#3f3826', trim: '#fbbf24', carpet: null },
  handoff: { floor: 'floor_6', tint: '#82b58f', wall: '#27402f', trim: '#4ade80', carpet: null },
  waiting: { floor: 'floor_4', tint: '#c09070', wall: '#3f2f26', trim: '#fb923c', carpet: 'carpet_1', carpetTint: '#a8674a' },
  lounge: { floor: 'floor_2', tint: '#9b8fc4', wall: '#2f2a3f', trim: '#c4b5fd', carpet: 'carpet_2', carpetTint: '#6d5f9e' },
};

const AGENT_COLOR = {
  blue: '#5b8ff9', green: '#4ade80', purple: '#a78bfa', orange: '#fb923c',
  red: '#f87171', cyan: '#22d3ee', yellow: '#fbbf24', pink: '#f472b6',
};

const FURNITURE = {
  desk: 'furniture/DESK/DESK_FRONT.png',
  pcOn1: 'furniture/PC/PC_FRONT_ON_1.png',
  pcOn2: 'furniture/PC/PC_FRONT_ON_2.png',
  pcOn3: 'furniture/PC/PC_FRONT_ON_3.png',
  pcOff: 'furniture/PC/PC_FRONT_OFF.png',
  sofa: 'furniture/SOFA/SOFA_FRONT.png',
  coffeeTable: 'furniture/COFFEE_TABLE/COFFEE_TABLE.png',
  bookshelf: 'furniture/BOOKSHELF/BOOKSHELF.png',
  clock: 'furniture/CLOCK/CLOCK.png',
  whiteboard: 'furniture/WHITEBOARD/WHITEBOARD.png',
  plant: 'furniture/PLANT/PLANT.png',
  largePlant: 'furniture/LARGE_PLANT/LARGE_PLANT.png',
  cactus: 'furniture/CACTUS/CACTUS.png',
  chair: 'furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_FRONT.png',
  bench: 'furniture/CUSHIONED_BENCH/CUSHIONED_BENCH_FRONT.png',
  bin: 'furniture/BIN/BIN.png',
  painting: 'furniture/LARGE_PAINTING/LARGE_PAINTING.png',
  smallPainting: 'furniture/SMALL_PAINTING/SMALL_PAINTING.png',
  smallTable: 'furniture/SMALL_TABLE/SMALL_TABLE.png',
  coffee: 'furniture/COFFEE/COFFEE.png',
};

function hash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = {};
    this.sprites = Array.from({ length: SPRITE_COUNT }, (_, i) => this.load(`characters/char_${i}.png`));
    for (const [key, file] of Object.entries(FURNITURE)) this.img[key] = this.load(file);
    for (let i = 0; i < 9; i++) this.img[`floor_${i}`] = this.load(`floors/floor_${i}.png`);
    for (let i = 0; i < 3; i++) this.img[`carpet_${i}`] = this.load(`carpets/carpet_${i}.png`);

    this.people = new Map();
    this.labels = {};
    this.tick = 0;
    this.running = false;
    this.hover = null;
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; });
  }

  load(file) {
    const img = new Image();
    img.src = `./assets/${file}`;
    return img;
  }

  ready(img) {
    return img?.complete && img.naturalWidth > 0;
  }

  onMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VW;
    const y = ((event.clientY - rect.top) / rect.height) * VH;
    this.hover = null;
    for (const p of this.people.values()) {
      if (x > p.x - 4 * PX && x < p.x + 20 * PX && y > p.y - 6 * PX && y < p.y + 36 * PX) this.hover = p;
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
    const cellW = 52 * PX;
    const cellH = 50 * PX;
    const perRow = Math.max(1, Math.floor((rect.w - 10 * PX) / cellW));
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    return {
      x: rect.x + 14 * PX + col * cellW,
      y: rect.y + WALL_H + 22 * PX + row * cellH,
    };
  }

  update(project, roomLabels) {
    if (roomLabels) this.labels = roomLabels;
    const crew = project?.crew || [];
    const perRoom = {};
    const seen = new Set();

    for (const member of crew) {
      const id = `${member.kind}:${member.name}`;
      perRoom[member.room] = (perRoom[member.room] || 0) + 1;
      const target = this.seat(member.room, perRoom[member.room] - 1);
      seen.add(id);

      let person = this.people.get(id);
      if (!person) {
        person = {
          id,
          x: target.x,
          y: target.y,
          sprite: hash(member.name) % SPRITE_COUNT,
          phase: hash(member.name) % 120,
        };
        this.people.set(id, person);
      }
      person.tx = target.x;
      person.ty = target.y;
      Object.assign(person, member);
    }

    for (const id of [...this.people.keys()]) if (!seen.has(id)) this.people.delete(id);
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

  sprite(key, x, y, scale = PX) {
    const img = this.img[key];
    if (!this.ready(img)) return;
    this.ctx.drawImage(img, Math.round(x), Math.round(y),
      img.naturalWidth * scale, img.naturalHeight * scale);
  }

  tag(cx, y, text, bg, fg) {
    const ctx = this.ctx;
    ctx.font = `${7 * PX}px ui-monospace, Menlo, monospace`;
    const w = ctx.measureText(text).width + 6 * PX;
    this.p(cx - w / 2, y, w, 10 * PX, bg);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, y + 7.5 * PX);
  }

  // ---- rooms ----

  drawFloor(rect, style) {
    const img = this.img[style.floor];
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    if (this.ready(img)) {
      const size = img.naturalWidth * PX;
      for (let y = rect.y; y < rect.y + rect.h; y += size) {
        for (let x = rect.x; x < rect.x + rect.w; x += size) {
          ctx.drawImage(img, Math.round(x), Math.round(y), size, size);
        }
      }
    } else {
      this.p(rect.x, rect.y, rect.w, rect.h, '#4a4458');
    }

    // gri tile'ı odanın rengine boya
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = style.tint;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalCompositeOperation = 'source-over';

    if (style.carpet && this.ready(this.img[style.carpet])) {
      const c = this.img[style.carpet];
      const cw = c.naturalWidth * PX;
      const ch = c.naturalHeight * PX;
      const cx = Math.round(rect.x + rect.w / 2 - cw / 2);
      const cy = Math.round(rect.y + rect.h - ch - 6 * PX);
      ctx.drawImage(c, cx, cy, cw, ch);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cw, ch);
      ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = style.carpetTint || style.tint;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  drawTv(x, y) {
    const flicker = Math.sin(this.tick * 0.08) > 0;
    this.p(x - 1 * PX, y - 1 * PX, 34 * PX, 22 * PX, '#15131c');
    this.p(x, y, 32 * PX, 20 * PX, '#1f2b3a');
    this.p(x + 2 * PX, y + 2 * PX, 28 * PX, 16 * PX, flicker ? '#3f6f8f' : '#37627e');
    this.p(x + 4 * PX, y + 4 * PX, 10 * PX, 4 * PX, 'rgba(255,255,255,0.25)');
    this.p(x + 12 * PX, y + 20 * PX, 8 * PX, 3 * PX, '#2a2634');
  }

  decorate(room, rect) {
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;

    if (room === 'work') {
      this.sprite('whiteboard', rect.x + 10 * PX, rect.y + 2 * PX);
      this.sprite('bin', right - 20 * PX, bottom - 22 * PX);
      this.sprite('largePlant', right - 40 * PX, bottom - 50 * PX);
    } else if (room === 'test') {
      this.sprite('whiteboard', right - 42 * PX, rect.y + 2 * PX);
      this.sprite('cactus', rect.x + 8 * PX, bottom - 36 * PX);
      this.sprite('bin', right - 20 * PX, bottom - 22 * PX);
    } else if (room === 'pm') {
      this.sprite('bookshelf', rect.x + 10 * PX, rect.y + 6 * PX);
      this.sprite('clock', rect.x + rect.w / 2 - 4 * PX, rect.y + 6 * PX);
      this.sprite('painting', right - 42 * PX, rect.y + 4 * PX);
      this.sprite('largePlant', right - 38 * PX, bottom - 52 * PX);
    } else if (room === 'lounge') {
      this.drawTv(rect.x + rect.w / 2 - 16 * PX, rect.y + 4 * PX);
      this.sprite('sofa', rect.x + rect.w / 2 - 16 * PX, bottom - 44 * PX);
      this.sprite('coffeeTable', rect.x + rect.w / 2 - 16 * PX, bottom - 30 * PX);
      this.sprite('largePlant', rect.x + 8 * PX, bottom - 52 * PX);
      this.sprite('coffee', right - 24 * PX, bottom - 24 * PX);
    } else if (room === 'handoff') {
      this.sprite('smallTable', rect.x + 12 * PX, bottom - 34 * PX);
      for (let i = 0; i < 3; i++) {
        const bx = rect.x + 14 * PX + i * 14 * PX;
        this.p(bx, bottom - 44 * PX, 11 * PX, 8 * PX, '#c8b088');
        this.p(bx, bottom - 46 * PX, 11 * PX, 3 * PX, '#e0cba4');
      }
      this.sprite('smallPainting', right - 26 * PX, rect.y + 6 * PX);
      this.sprite('plant', right - 22 * PX, bottom - 30 * PX);
    } else if (room === 'waiting') {
      this.sprite('bench', rect.x + 12 * PX, bottom - 30 * PX);
      this.sprite('clock', right - 20 * PX, rect.y + 6 * PX);
      this.sprite('smallTable', right - 44 * PX, bottom - 32 * PX);
      this.sprite('plant', rect.x + rect.w / 2, bottom - 30 * PX);
    }
  }

  drawRoom(room) {
    const ctx = this.ctx;
    const rect = this.roomRect(room);
    const style = ROOM_STYLE[room];

    this.drawFloor(rect, style);
    this.p(rect.x, rect.y, rect.w, WALL_H, style.wall);
    this.p(rect.x, rect.y + WALL_H, rect.w, 2 * PX, 'rgba(0,0,0,0.5)');
    this.p(rect.x, rect.y + WALL_H - 3 * PX, rect.w, 3 * PX, 'rgba(255,255,255,0.07)');
    this.p(rect.x, rect.y, rect.w, 2 * PX, style.trim);

    this.decorate(room, rect);

    ctx.font = `bold ${9 * PX}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = style.trim;
    ctx.textAlign = 'left';
    ctx.fillText(this.labels[room] || room.toUpperCase(), rect.x + 6 * PX, rect.y + 15 * PX);

    const count = this.roomCounts?.[room] || 0;
    ctx.textAlign = 'right';
    ctx.fillStyle = count ? '#efedf6' : 'rgba(255,255,255,0.22)';
    ctx.fillText(String(count), rect.x + rect.w - 6 * PX, rect.y + 15 * PX);
  }

  // ---- people ----

  drawPerson(p, walking) {
    const img = this.sprites[p.sprite % SPRITE_COUNT];
    const bob = walking ? 0 : Math.round(Math.sin((this.tick + p.phase) * 0.05)) * PX;
    const x = p.x;
    const y = p.y + bob;

    if (p.active) {
      this.ctx.fillStyle = 'rgba(74,222,128,0.20)';
      this.ctx.beginPath();
      this.ctx.ellipse(x + 8 * PX, y + 30 * PX, 14 * PX, 5 * PX, 0, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (p.waiting) {
      this.ctx.fillStyle = 'rgba(251,146,60,0.22)';
      this.ctx.beginPath();
      this.ctx.ellipse(x + 8 * PX, y + 30 * PX, 14 * PX, 5 * PX, 0, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.fillStyle = 'rgba(0,0,0,0.32)';
    this.ctx.beginPath();
    this.ctx.ellipse(x + 8 * PX, y + 31 * PX, 6 * PX, 2.5 * PX, 0, 0, Math.PI * 2);
    this.ctx.fill();

    if (!this.ready(img)) {
      this.p(x + 3 * PX, y + 10 * PX, 10 * PX, 20 * PX, '#5b5570');
      return;
    }
    const col = walking ? 1 + Math.floor((this.tick / 5 + p.phase) % 6) : 0;
    const seated = !walking && (p.room === 'work' || p.room === 'test' || p.room === 'pm');
    const row = seated ? 2 : 0;
    this.ctx.globalAlpha = p.idleAtDesk && !p.active ? 0.55 : 1;
    this.ctx.drawImage(img, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H,
      Math.round(x), Math.round(y), FRAME_W * PX, FRAME_H * PX);
    this.ctx.globalAlpha = 1;
  }

  draw() {
    const ctx = this.ctx;
    this.tick += 1;
    if (this.canvas.width !== VW) {
      this.canvas.width = VW;
      this.canvas.height = VH;
    }
    ctx.imageSmoothingEnabled = false;
    this.p(0, 0, VW, VH, '#100f16');

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

      const atDesk = !walking && (p.room === 'work' || p.room === 'test' || p.room === 'pm');
      if (atDesk) {
        this.sprite('desk', p.x - 16 * PX, p.y - 4 * PX);
        const pcFrame = p.active ? ['pcOn1', 'pcOn2', 'pcOn3'][Math.floor(this.tick / 12) % 3] : 'pcOff';
        this.sprite(pcFrame, p.x, p.y - 20 * PX);
      }
      this.drawPerson(p, walking);

      if (p.task && !walking) {
        this.tag(p.x + 8 * PX, p.y - 26 * PX, `#${p.task.id}`, 'rgba(14,13,20,0.92)', '#e8e6f0');
      }
      if (p.tool && p.active) {
        this.tag(p.x + 8 * PX, p.y - 38 * PX, p.tool.slice(0, 22), 'rgba(14,13,20,0.92)', '#4ade80');
      }
      if (p.waiting) {
        this.tag(p.x + 8 * PX, p.y - 26 * PX, 'SORU VAR', '#7c2d12', '#fed7aa');
      }

      ctx.font = `${7 * PX}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.waiting ? '#fb923c' : p.active ? '#4ade80' : p.idleAtDesk ? '#8f89a8' : '#b9b3cc';
      const short = String(p.name)
        .replace(/-specialist$/, '').replace(/-reviewer$/, '')
        .replace(/-manager$/, '-mgr').replace(/-designer$/, '-ux');
      ctx.fillText(short.length > 14 ? short.slice(0, 13) + '…' : short, p.x + 8 * PX, p.y + 40 * PX);

      if (p.color && AGENT_COLOR[p.color]) {
        this.p(p.x + 1 * PX, p.y + 42 * PX, 14 * PX, 2 * PX, AGENT_COLOR[p.color]);
      }
      if (p.kind === 'session') {
        this.p(p.x + 1 * PX, p.y + 42 * PX, 14 * PX, 2 * PX, '#6b6680');
      }
      if (p.queue > 0) this.tag(p.x + 21 * PX, p.y - 4 * PX, String(p.queue), '#6d28d9', '#ffffff');
      if (p.testRounds > 0) this.tag(p.x - 5 * PX, p.y - 4 * PX, `↺${p.testRounds}`, '#7f1d1d', '#fecaca');
    }

    if (this.hover) {
      const h = this.hover;
      const text = h.question?.text
        ? `${h.name}: ${h.question.text.slice(-70)}`
        : h.task ? `${h.name}: #${h.task.id} ${h.task.subject}`
          : h.description ? `${h.name} — ${h.description}`
            : `${h.name}: kuyruk boş`;
      ctx.font = `${8 * PX}px ui-monospace, Menlo, monospace`;
      const label = text.length > 70 ? text.slice(0, 69) + '…' : text;
      const w = ctx.measureText(label).width + 10 * PX;
      const bx = Math.max(GAP, Math.min(VW - w - GAP, h.x - w / 2));
      const by = Math.max(4 * PX, h.y - 50 * PX);
      this.p(bx, by, w, 14 * PX, 'rgba(10,9,15,0.96)');
      this.p(bx, by, 2 * PX, 14 * PX, '#8b7dfa');
      ctx.fillStyle = '#e8e6f0';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 5 * PX, by + 10 * PX);
    }
  }
}
