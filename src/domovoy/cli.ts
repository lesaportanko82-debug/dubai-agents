/**
 *   npm run domovoy -- "Машу забрать в 17:00, купить молоко, полить цветы"
 * Requires OPENAI_API_KEY or ANTHROPIC_API_KEY. Demo family in memory; author = mum.
 */
import { runDispatch } from './agent';
import { DEMO_FAMILY } from './fixtures';
import { InMemoryDomovoyStore } from './store';
import { getModelClient } from '../owed/llm';

const text = process.argv.slice(2).join(' ').trim();
if (!text) { console.error('Pass a message as an argument.'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) { console.error('Set OPENAI_API_KEY or ANTHROPIC_API_KEY.'); process.exit(1); }

const store = new InMemoryDomovoyStore(DEMO_FAMILY);
const res = await runDispatch(await getModelClient(), store, 'mum', text);
for (const s of res.trace) { console.log(`→ ${s.tool}(${JSON.stringify(s.input).slice(0, 300)})`); console.log(`  ← ${JSON.stringify(s.output).slice(0, 400)}`); }
console.log('\n' + res.summary);
console.log('\nOutbox:');
for (const m of await store.outbox()) console.log(`  [${m.lang}] → ${m.toId}: ${m.text}`);
