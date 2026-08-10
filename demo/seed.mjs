#!/usr/bin/env node
// Sahte bir ~/.claude ağacı üretir; `npm run demo` bunu HOME olarak kullanıp
// crewdesk'i doldurur. Gerçek verinize hiç dokunulmaz — ekran görüntüleri,
// katkı geliştirmesi ve "önce bir bakayım" durumu için.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEMO_HOME = process.env.CREWDESK_DEMO_HOME
  || path.join(os.tmpdir(), 'crewdesk-demo');

// Bizim ürettiğimiz dizinin işareti. CREWDESK_DEMO_HOME yanlış verilmişse
// kullanıcının dizinini silmemek için bakılan tek şey bu.
const MARKER = '.crewdesk-demo';

// Her zaman damgası seed() çağrıldığı ana göre türetilir; demo sunucusu bu
// dosyaları periyodik olarak yeniden yazdığı için ekran canlı kalır.
let now = Date.now();
const min = (n) => n * 60 * 1000;

const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const iso = (offsetMs) => new Date(now - offsetMs).toISOString();

const PROJECTS = [
  {
    dir: 'storefront',
    branch: 'feat/checkout-retry',
    sessions: [
      {
        id: 'a1b2c3d4-0001-4aaa-9000-000000000001',
        title: 'Checkout keeps double-charging on retry',
        lastTool: 'Edit',
        idle: min(0.2),
        subagents: [
          { file: 'agent-1001', role: 'frontend-dev', tool: 'Edit', idle: min(0.1) },
          { file: 'agent-1002', role: 'qa-tester', tool: 'Bash', idle: min(0.3) },
          { file: 'agent-1003', role: 'backend-dev', tool: 'Read', idle: min(42) },
        ],
      },
    ],
    agents: [
      ['project-manager', 'cyan', 'Splits work across the crew and collects results.'],
      ['frontend-dev', 'green', 'Storefront UI, checkout flow, component library.'],
      ['backend-dev', 'blue', 'Order service, inventory, webhooks.'],
      ['qa-tester', 'yellow', 'Regression scenarios and release sign-off.'],
      ['ux-designer', 'purple', 'Flows, empty states, copy review.'],
    ],
    tasks: [
      ['Stop the retry button from charging twice', 'in_progress', 'dev', 'frontend-dev', 0],
      ['Idempotency key on the order endpoint', 'in_progress', 'dev', 'backend-dev', 0],
      ['Cart totals disagree with the invoice on refunds', 'pending', 'test', 'qa-tester', 2],
      ['Empty-cart state has no illustration', 'pending', 'manager', 'ux-designer', 0],
      ['Guest checkout drops the discount code', 'pending', 'manager', null, 0],
      ['Order confirmation email renders raw HTML', 'completed', 'done', 'backend-dev', 0],
    ],
  },
  {
    dir: 'payments-api',
    branch: 'main',
    sessions: [
      {
        id: 'b2c3d4e5-0002-4bbb-9000-000000000002',
        title: 'Move settlement job off the request path',
        lastTool: 'Bash',
        idle: min(3),
        question: 'Two options for the settlement job: keep it in-process behind a queue, '
          + 'or split it into its own worker. The worker is more moving parts but survives a deploy '
          + 'mid-batch. Which way do you want to go?',
        subagents: [
          { file: 'agent-2001', role: 'security-reviewer', tool: 'Grep', idle: min(4) },
        ],
      },
    ],
    agents: [
      ['project-manager', 'cyan', 'Plans the work and reviews handoffs.'],
      ['api-dev', 'blue', 'Endpoints, contracts, migrations.'],
      ['security-reviewer', 'red', 'Authn/authz, secrets, dependency review.'],
      ['qa-tester', 'yellow', 'Contract tests and load checks.'],
    ],
    tasks: [
      ['Settlement job blocks the request thread', 'in_progress', 'dev', 'api-dev', 0],
      ['Rotate the webhook signing secret', 'pending', 'manager', 'security-reviewer', 0],
      ['Refund endpoint returns 200 on a failed capture', 'pending', 'test', 'qa-tester', 1],
      ['Rate limit is per-process, not per-account', 'pending', 'manager', null, 0],
      ['Drop the unused ledger_v1 table', 'completed', 'done', 'api-dev', 0],
    ],
  },
  {
    dir: 'mobile-app',
    branch: 'release/2.4',
    sessions: [
      {
        id: 'c3d4e5f6-0003-4ccc-9000-000000000003',
        title: 'Push notifications silent on Android 15',
        lastTool: 'Read',
        idle: min(26),
      },
    ],
    agents: [],   // ajan tanımı olmayan proje: tek kişi çalışır
    tasks: [
      ['Notification channel missing on first launch', 'in_progress', 'dev', null, 0],
      ['Deep link opens the wrong tab from a cold start', 'pending', 'manager', null, 0],
    ],
  },
  {
    dir: 'docs-site',
    branch: 'main',
    sessions: [
      {
        id: 'd4e5f6a7-0004-4ddd-9000-000000000004',
        title: 'Rewrite the getting-started page',
        lastTool: 'Write',
        idle: min(95),
      },
    ],
    agents: [
      ['docs-writer', 'orange', 'Guides, reference, release notes.'],
      ['project-manager', 'cyan', 'Keeps the docs backlog honest.'],
    ],
    tasks: [
      ['Getting started assumes a global install', 'pending', 'manager', 'docs-writer', 0],
      ['Screenshots are three releases out of date', 'completed', 'done', 'docs-writer', 0],
    ],
  },
];

function encodeProjectDir(cwd) {
  return cwd.replace(/\//g, '-');
}

// Dizini silmeden önce gerçekten bize ait olduğunu doğrula. Varsayılan yol
// (tmp/crewdesk-demo) bizimdir; CREWDESK_DEMO_HOME elle verilmişse yanlış bir
// yol tüm dizini silebilir, o yüzden ya boş ya da işaretçimizi taşıyor olmalı.
function resetDemoHome() {
  if (process.env.CREWDESK_DEMO_HOME && fs.existsSync(DEMO_HOME)
    && !fs.existsSync(path.join(DEMO_HOME, MARKER))
    && fs.readdirSync(DEMO_HOME).length > 0) {
    throw new Error(`refusing to erase ${DEMO_HOME}: it has no ${MARKER} marker, so it is not a `
      + 'crewdesk demo directory. Point CREWDESK_DEMO_HOME at an empty or unused directory.');
  }
  fs.rmSync(DEMO_HOME, { recursive: true, force: true });
  fs.mkdirSync(DEMO_HOME, { recursive: true });
  fs.writeFileSync(path.join(DEMO_HOME, MARKER), 'crewdesk demo data — safe to delete\n');
}

// refresh: dizini silmeden yalnızca zaman damgalarını tazeler. Canlılık dosya
// mtime'ından okunduğu için JSON içindeki timestamp'i güncellemek yetmez; her
// dosya yeniden yazılıp utimes'ı da geri alınır. Kullanıcının taşıdığı kartlar
// (overlay/events) tazelemede korunur.
export function seed({ refresh = false } = {}) {
  now = Date.now();
  if (!refresh) resetDemoHome();

  const overlay = {};
  const events = [];
  const buckets = { v: 2, global: {}, session: {} };
  const hour = Math.floor(now / 1000 / 3600);

  for (const project of PROJECTS) {
    const cwd = path.join(DEMO_HOME, 'projects', project.dir);
    const encoded = encodeProjectDir(cwd);

    for (const [name, color, description] of project.agents) {
      write(path.join(cwd, '.claude', 'agents', `${name}.md`),
        `---\nname: ${name}\ndescription: ${description}\ncolor: ${color}\n---\n\n${description}\n`);
    }

    for (const session of project.sessions) {
      const base = { sessionId: session.id, cwd, gitBranch: project.branch, userType: 'external' };
      const rows = [
        { ...base, type: 'user', customTitle: session.title, timestamp: iso(min(120)) },
        {
          ...base,
          type: 'assistant',
          timestamp: iso(session.idle + min(1)),
          message: { model: 'claude-opus-5', content: [{ type: 'tool_use', name: session.lastTool, input: {} }] },
        },
      ];
      if (session.question) {
        rows.push({
          ...base,
          type: 'assistant',
          timestamp: iso(session.idle),
          message: { model: 'claude-opus-5', content: [{ type: 'text', text: session.question }] },
        });
      }
      const file = path.join(DEMO_HOME, '.claude', 'projects', encoded, `${session.id}.jsonl`);
      write(file, jsonl(rows));
      fs.utimesSync(file, new Date(now - session.idle), new Date(now - session.idle));

      for (const sub of session.subagents || []) {
        const subFile = path.join(DEMO_HOME, '.claude', 'projects', encoded, session.id,
          'subagents', `${sub.file}.jsonl`);
        write(subFile, jsonl([
          { isSidechain: true, agentId: sub.file, attributionAgent: sub.role, type: 'user', ...base, timestamp: iso(min(20)) },
          {
            isSidechain: true, agentId: sub.file, attributionAgent: sub.role, type: 'assistant', ...base,
            timestamp: iso(sub.idle),
            message: { model: 'claude-opus-5', content: [{ type: 'tool_use', name: sub.tool, input: {} }] },
          },
        ]));
        fs.utimesSync(subFile, new Date(now - sub.idle), new Date(now - sub.idle));
      }

      project.tasks.forEach(([subject, status, stage, owner, rounds], index) => {
        const id = String(index + 1);
        write(path.join(DEMO_HOME, '.claude', 'tasks', session.id, `${id}.json`),
          JSON.stringify({ id, subject, description: subject, status, blocks: [], blockedBy: [] }, null, 2));

        const key = `${session.id}:${id}`;
        overlay[key] = { stage, owner, testRounds: rounds, history: [{ stage, at: now - min(30) }] };
        if (owner) {
          events.push({ ts: now - min(60 - index), taskKey: key, taskId: id, project: encoded, from: null, to: owner, event: 'assigned' });
        }
      });

      buckets.session[`${hour}:${session.id}`] = 180000 + (session.id.charCodeAt(3) % 7) * 41000;
    }
  }

  for (let i = 0; i < 24 * 7; i++) {
    buckets.global[hour - i] = i < 5
      ? 620000 - i * 40000
      : Math.round(380000 * Math.abs(Math.sin(i)) + 60000);
  }

  write(path.join(DEMO_HOME, '.claude', 'session-monitor', 'token-buckets.json'), JSON.stringify(buckets, null, 1));
  write(path.join(DEMO_HOME, '.claude', 'session-monitor', 'official-usage.json'), JSON.stringify({ gauges: [], ts: 0 }));
  if (!refresh) {
    write(path.join(DEMO_HOME, '.crewdesk', 'overlay.json'), JSON.stringify(overlay, null, 2));
    write(path.join(DEMO_HOME, '.crewdesk', 'events.jsonl'), jsonl(events));
  }

  return DEMO_HOME;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(`crewdesk demo data → ${seed()}`);
  } catch (error) {
    process.stderr.write(`crewdesk: ${error.message}\n`);
    process.exit(1);
  }
}
