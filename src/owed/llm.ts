import type { ContentBlock, ModelClient, ModelResponse, ToolDef } from './agent';

/**
 * Provider switch. The agent speaks one internal format (Claude Messages shape);
 * adapters translate to each provider.
 *   LLM_PROVIDER=openai     -> OPENAI_API_KEY, OPENAI_MODEL (default gpt-5-mini)
 *   LLM_PROVIDER=anthropic  -> ANTHROPIC_API_KEY, OWED_MODEL
 */
export async function getModelClient(): Promise<ModelClient> {
  const provider = (process.env.LLM_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'openai' : 'anthropic')).toLowerCase();
  if (provider === 'openai') return openAiClient();
  const { anthropicClient } = await import('./agent');
  return anthropicClient();
}

export function defaultModel(): string {
  const provider = (process.env.LLM_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'openai' : 'anthropic')).toLowerCase();
  return provider === 'openai' ? process.env.OPENAI_MODEL ?? 'gpt-5-mini' : process.env.OWED_MODEL ?? 'claude-sonnet-5-5';
}

/* ---------- OpenAI Chat Completions adapter (no SDK, plain fetch) ---------- */
export function openAiClient(apiKey = process.env.OPENAI_API_KEY, baseUrl = 'https://api.openai.com/v1'): ModelClient {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  return {
    async create(req) {
      const body: Record<string, unknown> = {
        model: req.model,
        max_completion_tokens: req.max_tokens * 4, // reasoning models spend tokens before answering
        messages: toOpenAiMessages(req.system, req.messages as any[]),
      };
      if (req.tools.length) body.tools = req.tools.map(toOpenAiTool);

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
      return fromOpenAi(await res.json());
    },
  };
}

function toOpenAiTool(t: ToolDef) {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
}

export function toOpenAiMessages(system: string, messages: any[]): any[] {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks = m.content as any[];
    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = blocks.filter(b => b.type === 'tool_use');
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length && {
          tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })),
        }),
      });
    } else {
      for (const b of blocks) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
        else if (b.type === 'text') out.push({ role: 'user', content: b.text });
      }
    }
  }
  return out;
}

export function fromOpenAi(json: any): ModelResponse {
  const choice = json.choices?.[0];
  const msg = choice?.message ?? {};
  const content: ContentBlock[] = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  for (const tc of msg.tool_calls ?? []) {
    let input: unknown = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = { _raw: tc.function?.arguments }; }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
  }
  const stop_reason = msg.tool_calls?.length ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
  return { stop_reason, content };
}
