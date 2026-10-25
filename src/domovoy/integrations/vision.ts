/**
 * Vision integration for Domovoy.
 *
 * Analyzes photos sent by family members to automatically create tasks.
 * Uses GPT-4o vision or Claude vision API depending on LLM_PROVIDER.
 *
 * Examples:
 *  - Photo of a messy room → "Убрать комнату" / "Clean the room"
 *  - Photo of empty fridge → "Купить продукты" / "Buy groceries"
 *  - Photo of broken item → "Починить / заменить X" / "Fix / replace X"
 *  - Photo of dirty dishes → "Помыть посуду" / "Wash the dishes"
 */

export interface VisionAnalysis {
  description: string;          // what the AI sees
  suggestedTasks: VisionTask[];
  confidence: number;           // 0..1
  category: 'mess' | 'maintenance' | 'shopping' | 'safety' | 'other';
}

export interface VisionTask {
  text: { ru: string; en: string };
  minutes: number;
  skills: string[];
  kidSafe: boolean;
  urgent: boolean;
}

const VISION_PROMPT = `You are Domovoy, a household AI agent. A family member sent this photo.
Analyze it and determine if it implies any household tasks.

Respond in JSON:
{
  "description": "Brief description of what you see",
  "category": "mess" | "maintenance" | "shopping" | "safety" | "other",
  "confidence": 0.0-1.0,
  "tasks": [
    {
      "text_ru": "Задача на русском",
      "text_en": "Task in English",
      "minutes": 15,
      "skills": ["clean", "cook", "shop", ...],
      "kid_safe": true/false,
      "urgent": true/false
    }
  ]
}

Only suggest tasks when the photo clearly implies something needs doing.
If it's just a regular photo (selfie, scenery, etc.), set confidence to 0 and tasks to [].
Be specific about what needs doing based on what you see.`;

/** Analyze a photo and extract task suggestions. */
export async function analyzePhoto(imageUrl: string, provider?: string): Promise<VisionAnalysis> {
  const llmProvider = provider ?? process.env.LLM_PROVIDER ?? 'openai';

  try {
    if (llmProvider === 'anthropic') {
      return await analyzeWithClaude(imageUrl);
    }
    return await analyzeWithOpenAI(imageUrl);
  } catch (err) {
    console.error('Vision analysis error:', err);
    return { description: 'Could not analyze photo', suggestedTasks: [], confidence: 0, category: 'other' };
  }
}

async function analyzeWithOpenAI(imageUrl: string): Promise<VisionAnalysis> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return demoAnalysis();

  const isBase64 = imageUrl.startsWith('data:');
  const isTgFile = imageUrl.startsWith('tg:');

  let imageContent: any;
  if (isTgFile) {
    // Download from Telegram first
    const fileUrl = await getTelegramFileUrl(imageUrl.slice(3));
    if (!fileUrl) return demoAnalysis();
    imageContent = { type: 'image_url', image_url: { url: fileUrl } };
  } else if (isBase64) {
    imageContent = { type: 'image_url', image_url: { url: imageUrl } };
  } else {
    imageContent = { type: 'image_url', image_url: { url: imageUrl } };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: VISION_PROMPT },
        { role: 'user', content: [{ type: 'text', text: 'Analyze this photo:' }, imageContent] },
      ],
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    console.error('OpenAI Vision error:', res.status);
    return demoAnalysis();
  }

  const data = await res.json() as any;
  const text = data.choices?.[0]?.message?.content ?? '{}';
  return parseVisionResponse(text);
}

async function analyzeWithClaude(imageUrl: string): Promise<VisionAnalysis> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return demoAnalysis();

  const isTgFile = imageUrl.startsWith('tg:');
  let imageSource: any;

  if (isTgFile) {
    const fileUrl = await getTelegramFileUrl(imageUrl.slice(3));
    if (!fileUrl) return demoAnalysis();
    // Download and convert to base64
    const imgRes = await fetch(fileUrl);
    if (!imgRes.ok) return demoAnalysis();
    const buf = Buffer.from(await imgRes.arrayBuffer());
    imageSource = { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') };
  } else {
    imageSource = { type: 'url', url: imageUrl };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: VISION_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: imageSource },
          { type: 'text', text: 'Analyze this photo:' },
        ],
      }],
    }),
  });

  if (!res.ok) {
    console.error('Claude Vision error:', res.status);
    return demoAnalysis();
  }

  const data = await res.json() as any;
  const text = data.content?.[0]?.text ?? '{}';
  return parseVisionResponse(text);
}

function parseVisionResponse(text: string): VisionAnalysis {
  try {
    // Extract JSON from possible markdown wrapping
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      description: parsed.description ?? '',
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0)),
      category: parsed.category ?? 'other',
      suggestedTasks: (parsed.tasks ?? []).map((t: any) => ({
        text: { ru: t.text_ru ?? t.text ?? '', en: t.text_en ?? t.text ?? '' },
        minutes: t.minutes ?? 15,
        skills: t.skills ?? [],
        kidSafe: t.kid_safe ?? false,
        urgent: t.urgent ?? false,
      })),
    };
  } catch {
    return { description: text.slice(0, 200), suggestedTasks: [], confidence: 0, category: 'other' };
  }
}

async function getTelegramFileUrl(fileId: string): Promise<string | undefined> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return undefined;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    if (!res.ok) return undefined;
    const data = await res.json() as any;
    const path = data.result?.file_path;
    if (!path) return undefined;
    return `https://api.telegram.org/file/bot${token}/${path}`;
  } catch { return undefined; }
}

function demoAnalysis(): VisionAnalysis {
  return {
    description: 'Kitchen with dirty dishes in the sink and items on the counter',
    confidence: 0.85,
    category: 'mess',
    suggestedTasks: [
      { text: { ru: 'Помыть посуду', en: 'Wash the dishes' }, minutes: 20, skills: ['clean'], kidSafe: true, urgent: false },
      { text: { ru: 'Протереть столешницу', en: 'Wipe the counter' }, minutes: 10, skills: ['clean'], kidSafe: true, urgent: false },
    ],
  };
}
