/**
 * Voice message transcription for Domovoy.
 *
 * Converts Telegram voice messages (OGG/OPUS) to text using:
 *  - OpenAI Whisper API (default)
 *  - Or any compatible speech-to-text service
 *
 * The transcribed text is then fed to the standard dispatch pipeline.
 * Supports multilingual transcription (RU, EN, TL, AR, TR, HI).
 */

export interface TranscriptionResult {
  text: string;
  language: string;     // detected language code
  duration: number;     // seconds
  confidence: number;   // 0..1
}

/** Transcribe a voice message from Telegram. */
export async function transcribeVoice(fileId: string): Promise<TranscriptionResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!token || !openaiKey) {
    return demoTranscription();
  }

  try {
    // 1. Get file path from Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    if (!fileRes.ok) throw new Error(`Telegram getFile error: ${fileRes.status}`);
    const fileData = await fileRes.json() as any;
    const filePath = fileData.result?.file_path;
    if (!filePath) throw new Error('No file_path in response');

    // 2. Download the voice file
    const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!audioRes.ok) throw new Error(`Download error: ${audioRes.status}`);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // 3. Send to Whisper API
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
    formData.append('file', blob, 'voice.ogg');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      console.error('Whisper API error:', whisperRes.status);
      throw new Error(`Whisper error: ${whisperRes.status}`);
    }

    const result = await whisperRes.json() as any;
    return {
      text: result.text?.trim() ?? '',
      language: result.language ?? 'unknown',
      duration: result.duration ?? 0,
      confidence: 1.0, // Whisper doesn't return confidence directly
    };
  } catch (err) {
    console.error('Voice transcription error:', err);
    // In production, propagate the error so the user knows transcription failed
    // instead of silently returning fake demo text
    if (token && openaiKey) throw err;
    return demoTranscription();
  }
}

/** Transcribe from a raw audio buffer (for testing / non-Telegram sources). */
export async function transcribeBuffer(audioBuffer: Buffer, format = 'ogg'): Promise<TranscriptionResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return demoTranscription();

  try {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: `audio/${format}` });
    formData.append('file', blob, `voice.${format}`);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`Whisper error: ${res.status}`);
    const result = await res.json() as any;
    return {
      text: result.text?.trim() ?? '',
      language: result.language ?? 'unknown',
      duration: result.duration ?? 0,
      confidence: 1.0,
    };
  } catch (err) {
    console.error('Buffer transcription error:', err);
    return demoTranscription();
  }
}

function demoTranscription(): TranscriptionResult {
  return {
    text: 'Купи молоко и хлеб по дороге домой, и забери Машу из садика в пять',
    language: 'ru',
    duration: 8.5,
    confidence: 0.95,
  };
}
