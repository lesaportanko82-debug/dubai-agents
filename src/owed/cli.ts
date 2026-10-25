/**
 * Usage:
 *   npm run owed -- "Смеситель MX-210 серия 102311 течёт из-под картриджа"
 * Requires ANTHROPIC_API_KEY. Uses synthetic demo data in memory.
 */
import { anthropicClient, runIntake } from './agent.js';
import { DEMO_BATCHES, DEMO_SUPPLIERS } from './fixtures.js';
import { InMemoryStore } from './store.js';

const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('Pass a complaint text as an argument.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set (see .env.example).');
  process.exit(1);
}

const store = new InMemoryStore(DEMO_SUPPLIERS, DEMO_BATCHES);
const res = await runIntake(await anthropicClient(), store, text, { channel: 'cli' });

for (const s of res.trace) {
  console.log(`→ ${s.tool}(${JSON.stringify(s.input)})`);
  console.log(`  ← ${JSON.stringify(s.output)}`);
}
console.log('\n' + res.summary);
