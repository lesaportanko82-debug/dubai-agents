/**
 * Usage:
 *   npm run owed -- "Смеситель MX-210 серия 102311 течёт из-под картриджа"
 * Requires OPENAI_API_KEY or ANTHROPIC_API_KEY. Uses synthetic demo data in memory.
 */
import { runIntake } from './agent';
import { DEMO_BATCHES, DEMO_SUPPLIERS } from './fixtures';
import { InMemoryStore } from './store';
import { getModelClient } from './llm';

const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('Pass a complaint text as an argument.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY or ANTHROPIC_API_KEY (see .env.example).');
  process.exit(1);
}

const store = new InMemoryStore(DEMO_SUPPLIERS, DEMO_BATCHES);
const res = await runIntake(await getModelClient(), store, text, { channel: 'cli' });

for (const s of res.trace) {
  console.log(`→ ${s.tool}(${JSON.stringify(s.input)})`);
  console.log(`  ← ${JSON.stringify(s.output)}`);
}
console.log('\n' + res.summary);
