import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromOpenAi, toOpenAiMessages } from '../src/owed/llm.js';

test('OpenAI adapter: tool_use/tool_result round-trip', () => {
  const msgs = toOpenAiMessages('SYS', [
    { role: 'user', content: 'complaint' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'find_batch', input: { sku: 'MX-210' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"found":true}' }] },
  ]);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[2].tool_calls[0].function.name, 'find_batch');
  assert.equal(msgs[3].role, 'tool');
  assert.equal(msgs[3].tool_call_id, 'call_1');
});

test('OpenAI adapter: response with tool calls maps to tool_use', () => {
  const r = fromOpenAi({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c2', function: { name: 'record_case', arguments: '{"sku":"KT-550"}' } }] } }] });
  assert.equal(r.stop_reason, 'tool_use');
  assert.deepEqual(r.content[0], { type: 'tool_use', id: 'c2', name: 'record_case', input: { sku: 'KT-550' } });
  const t = fromOpenAi({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] });
  assert.equal(t.stop_reason, 'end_turn');
});
