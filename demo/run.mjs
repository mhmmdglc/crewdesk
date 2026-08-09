#!/usr/bin/env node
// Demo verisini üretir ve crewdesk'i o sahte HOME ile başlatır.
import { seed, DEMO_HOME } from './seed.mjs';

seed();
process.env.HOME = DEMO_HOME;
process.env.USERPROFILE = DEMO_HOME;

const { start } = await import('../src/server.mjs');
const port = Number(process.argv[2] || 4610);
const { url } = await start({ port, host: '127.0.0.1' });
console.log(`crewdesk demo → ${url}  (fake data in ${DEMO_HOME})`);
