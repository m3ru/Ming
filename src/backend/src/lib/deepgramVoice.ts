import { createHash } from "node:crypto";
import { z } from "zod";
import { voiceSessionSchema, type VoiceMessage } from "./voice";

export const DEEPGRAM_AUDIO_BYTE_LIMIT = 1024 * 1024;
// Gemini and OpenAI both speak raw 16-bit little-endian mono PCM at 24 kHz: 48,000 bytes a
// second, so 4 MiB is about 87 s of speech.
export const PCM_BYTE_LIMIT = 4 * 1024 * 1024;
export const PCM_MIME_TYPE = "audio/L16; rate=24000; channels=1";
// Gemini 3.8 TTS reads any style direction aloud (verified by transcribing its output), so it
// gets only the line; delivery comes from how the reply is written.
// First audio arrived in ~0.7 s from Gemini and ~1.7 s from OpenAI; after this, Deepgram answers.
export const FIRST_AUDIO_MS = 3000;
// OpenAI documents webm, mp4 and wav uploads, not ogg (Firefox's recorder); those go straight to Deepgram.
const OPENAI_STT_FORMATS: Record<string, string> = { webm: "webm", mp4: "mp4", wav: "wav", "x-wav": "wav" };
// A 6 s clip took ~1.2 s with gpt-transcribe; after this, Deepgram transcribes the turn instead.
const OPENAI_STT_TIMEOUT_MS = 15_000;
// OpenAI takes delivery direction in its own field; transcribing its output showed none of it spoken.
const OPENAI_DELIVERY =
  "Speak naturally and conversationally, like a real person in a workplace conversation. Let the feeling in the words come through.";
const geminiEventSchema = z.object({
  error: z.unknown().optional(),
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
      })).optional(),
    }).optional(),
  })).optional(),
});
const PROVIDER_JSON_BYTE_LIMIT = 256 * 1024;
// IDs are kept for the TTL so a retry never re-bills a turn. 512 per 15 minutes is far
// above the hourly quota's 200 turns. Results hold text only; audio is streamed on request.
const CACHE_LIMIT = 512;
const CACHE_TTL_MS = 15 * 60_000;
// The first play plus retries; the turn's quota reservation already paid for speech.
const SPEECH_LIMIT = 3;
const PROVIDER_TIMEOUT_MS = 30_000;
const mimeTypeSchema = z.string().max(100).regex(
  /^audio\/(?:webm|ogg|mp4|wav|x-wav)(?:\s*;\s*codecs=(?:[a-zA-Z0-9._,-]+|"[a-zA-Z0-9._, -]+"))?$/i,
);
export const deepgramTurnSchema = voiceSessionSchema
  .omit({ sdp: true, resourceId: true })
  .extend({
    turnId: z.string().uuid(),
    audioBase64: z.string().min(4).max(4 * Math.ceil(DEEPGRAM_AUDIO_BYTE_LIMIT / 3)),
    mimeType: mimeTypeSchema,
  });
export const deepgramSpeechSchema = deepgramTurnSchema.pick({ turnId: true, threadId: true });
type Turn = z.infer<typeof deepgramTurnSchema>;
type Scope = { threadId: string; resourceId: string };
type DeepgramMessage = VoiceMessage & {
  metadata: NonNullable<VoiceMessage["metadata"]> & { voiceProvider: "deepgram" };
};
export type DeepgramTurnResult = {
  status: "success" | "partial";
  sessionId: string;
  // True only after the recognized user transcript has reached memory.
  persisted: boolean;
  messages: DeepgramMessage[];
  error?: string;
};
export class DeepgramVoiceError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 | 413 | 429 | 502 | 503 = 502,
  ) {
    super(message);
  }
}
type Dependencies = {
  apiKey: () => string | undefined;
  sttModel?: () => string | undefined;
  ttsModel?: () => string | undefined;
  // "openai" transcribes with OpenAI and falls back to Deepgram; any other value is Deepgram only.
  sttProvider?: () => string | undefined;
  openaiSttModel?: () => string | undefined;
  // "gemini" or "openai" speaks with that provider and falls back to Deepgram; any other value is Deepgram only.
  ttsProvider?: () => string | undefined;
  geminiApiKey?: () => string | undefined;
  geminiTtsModel?: () => string | undefined;
  geminiTtsVoice?: () => string | undefined;
  openaiApiKey?: () => string | undefined;
  openaiTtsModel?: () => string | undefined;
  openaiTtsVoice?: () => string | undefined;
  request?: typeof fetch;
  generate: (
    messages: VoiceMessage[],
    context: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<string>;
  save: (messages: VoiceMessage[], scope: Scope) => Promise<void>;
  reserve?: (identity: string) => () => void;
};
type CachedTurn = Scope & {
  fingerprint: string;
  expiresAt: number;
  sessionId: string;
  user?: DeepgramMessage;
  userSaved: boolean;
  assistant?: DeepgramMessage;
  assistantSaved: boolean;
  result?: DeepgramTurnResult;
  pending?: Promise<DeepgramTurnResult>;
  // Requests waiting on this turn; each hears every message as soon as it is saved.
  listeners: Set<(message: DeepgramMessage) => void>;
  speechRequests: number;
};

function audioBytes(base64: string) {
  // Buffer.from tolerates junk and truncated input; require canonical base64.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw new DeepgramVoiceError("Invalid audio recording.", 400);
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.toString("base64") !== base64)
    throw new DeepgramVoiceError("Invalid audio recording.", 400);
  if (bytes.length > DEEPGRAM_AUDIO_BYTE_LIMIT)
    throw new DeepgramVoiceError("The audio recording is too large. Record a shorter turn.", 413);
  return bytes;
}

async function boundedBody(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Provider response exceeded limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Gemini SSE events to raw PCM bytes. Events split across chunks are buffered. */
function geminiPcm() {
  const decoder = new TextDecoder();
  let buffered = "";
  let size = 0;
  const parse = (event: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5)).join("\n");
    if (!data.trim()) return;
    const parsed = geminiEventSchema.parse(JSON.parse(data));
    if (parsed.error !== undefined) throw new Error("Speech provider error.");
    for (const { inlineData } of parsed.candidates?.[0]?.content?.parts ?? []) {
      if (!inlineData) continue;
      if (!/^audio\/l16\s*(?:;|$)/i.test(inlineData.mimeType) || !/;\s*rate=24000\s*(?:;|$)/i.test(inlineData.mimeType))
        throw new Error("Unexpected speech format.");
      const bytes = Buffer.from(inlineData.data, "base64");
      size += bytes.byteLength;
      if (size > PCM_BYTE_LIMIT) throw new Error("Speech output exceeded limit.");
      if (bytes.byteLength) controller.enqueue(bytes);
    }
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true });
      // Hold a trailing \r back: it may be the first half of a \r\n split across chunks.
      const end = buffered.endsWith("\r") ? buffered.length - 1 : buffered.length;
      const events = buffered.slice(0, end).replace(/\r\n?/g, "\n").split("\n\n");
      buffered = events.pop()! + buffered.slice(end);
      if (buffered.length > 2 * PCM_BYTE_LIMIT) throw new Error("Speech event exceeded limit.");
      for (const event of events) parse(event, controller);
    },
    flush(controller) {
      parse((buffered + decoder.decode()).replace(/\r\n?/g, "\n"), controller);
    },
  });
}

/** Passes audio through, erroring the stream (and so the provider download) past the limit. */
function byteLimit(limit: number) {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) controller.error(new Error("Speech output exceeded limit."));
      else controller.enqueue(chunk);
    },
    flush(controller) {
      if (!size) controller.error(new Error("Empty speech output."));
    },
  });
}

function message(turn: CachedTurn, role: "user" | "assistant", content: string): DeepgramMessage {
  return {
    id: "voice-" + turn.sessionId + "-" + role,
    role,
    content,
    createdAt: new Date().toISOString(),
    metadata: {
      source: "live-voice",
      sessionId: turn.sessionId,
      voiceProvider: "deepgram",
      fragments: [],
    },
  };
}
function notify(listener: (message: DeepgramMessage) => void, message: DeepgramMessage) {
  try {
    listener(message);
  } catch {
    // A disconnected client must not fail or stall the saved turn.
  }
}
function partial(turn: CachedTurn, error: string): DeepgramTurnResult {
  return {
    status: "partial",
    sessionId: turn.sessionId,
    persisted: turn.userSaved,
    messages: [
      ...(turn.userSaved && turn.user ? [turn.user] : []),
      ...(turn.assistantSaved && turn.assistant ? [turn.assistant] : []),
    ],
    error,
  };
}

export function createDeepgramVoiceService(dependencies: Dependencies) {
  const request = dependencies.request ?? fetch;
  const turns = new Map<string, CachedTurn>();
  // A provider's PCM stream, or undefined when it fails before its first audio byte so Deepgram
  // can answer. A slow start falls back too, instead of leaving Bart silent until the full timeout.
  async function firstAudio(
    send: (signal: AbortSignal) => Promise<Response>,
    pcm: (response: Response & { body: ReadableStream<Uint8Array> }) => ReadableStream<Uint8Array> | undefined,
  ) {
    const started = new AbortController();
    const deadline = setTimeout(() => started.abort(), FIRST_AUDIO_MS);
    try {
      const response = await send(AbortSignal.any([AbortSignal.timeout(PROVIDER_TIMEOUT_MS), started.signal]));
      const audio = response.ok && response.body ? pcm(response as Response & { body: ReadableStream<Uint8Array> }) : undefined;
      if (!audio) {
        // The error body is never read or relayed.
        void response.body?.cancel().catch(() => {});
        return;
      }
      const reader = audio.getReader();
      const first = await reader.read();
      if (first.done) return;
      // After the first byte there is no fallback: a later failure errors the stream.
      return new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(first.value),
        async pull(controller) {
          const chunk = await reader.read();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        },
        cancel: (reason) => reader.cancel(reason),
      });
    } catch {
      return;
    } finally {
      clearTimeout(deadline);
    }
  }
  async function geminiSpeech(text: string) {
    const apiKey = dependencies.geminiApiKey?.()?.trim();
    if (!apiKey) return;
    const model = dependencies.geminiTtsModel?.()?.trim() || "gemini-3.8-flash-lite-tts";
    return firstAudio(
      (signal) => request(
        new URL("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse"),
        {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: {
                voiceName: dependencies.geminiTtsVoice?.()?.trim() || "Puck",
              } } },
            },
          }),
          signal,
          redirect: "error",
        },
      ),
      (response) => response.body.pipeThrough(geminiPcm()),
    );
  }
  // shortcut: OpenAI shuts /v1/audio/speech down on 2027-01-06 (its successor is Realtime-only);
  // after that this always falls back to Deepgram. Move to the Realtime API to keep OpenAI's voice.
  async function openaiSpeech(text: string) {
    const apiKey = dependencies.openaiApiKey?.()?.trim();
    if (!apiKey) return;
    return firstAudio(
      (signal) => request(new URL("https://api.openai.com/v1/audio/speech"), {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: dependencies.openaiTtsModel?.()?.trim() || "gpt-4o-mini-tts",
          voice: dependencies.openaiTtsVoice?.()?.trim() || "cedar",
          input: text,
          instructions: OPENAI_DELIVERY,
          response_format: "pcm",
        }),
        signal,
        redirect: "error",
      }),
      (response) =>
        /^audio\/pcm(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")
          ? response.body.pipeThrough(byteLimit(PCM_BYTE_LIMIT))
          : undefined,
    );
  }
  async function deepgramTranscript(input: Turn, apiKey: string, bytes: Buffer) {
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model", dependencies.sttModel?.()?.trim() || "nova-3");
    url.searchParams.set("smart_format", "true");
    const response = await request(url, {
      method: "POST",
      headers: { Authorization: "Token " + apiKey, "Content-Type": input.mimeType },
      body: new Uint8Array(bytes).buffer,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error("Transcription request failed.");
    }
    const result = z.object({
      results: z.object({ channels: z.array(z.object({
        alternatives: z.array(z.object({ transcript: z.string().max(32000) })),
      })).min(1) }),
    }).parse(JSON.parse((await boundedBody(response, PROVIDER_JSON_BYTE_LIMIT)).toString("utf8")));
    return result.results.channels[0].alternatives[0]?.transcript ?? "";
  }
  // OpenAI's transcript, or undefined on any failure so Deepgram transcribes instead.
  // An empty transcript is an answer (silence), not a failure.
  async function openaiTranscript(input: Turn, bytes: Buffer) {
    const apiKey = dependencies.openaiApiKey?.()?.trim();
    const format = OPENAI_STT_FORMATS[input.mimeType.split(";")[0].trim().toLowerCase().slice("audio/".length)];
    if (!apiKey || !format) return;
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: input.mimeType }), "turn." + format);
      form.append("model", dependencies.openaiSttModel?.()?.trim() || "gpt-transcribe");
      const response = await request(new URL("https://api.openai.com/v1/audio/transcriptions"), {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey },
        body: form,
        signal: AbortSignal.timeout(OPENAI_STT_TIMEOUT_MS),
        redirect: "error",
      });
      if (!response.ok) {
        // The error body is never read or relayed.
        void response.body?.cancel().catch(() => {});
        return;
      }
      return z.object({ text: z.string().max(32000) })
        .parse(JSON.parse((await boundedBody(response, PROVIDER_JSON_BYTE_LIMIT)).toString("utf8"))).text;
    } catch {
      return;
    }
  }
  async function processTurn(input: Turn, turn: CachedTurn, apiKey: string, bytes: Buffer) {
    if (!turn.user) {
      try {
        const openai = dependencies.sttProvider?.()?.trim().toLowerCase() === "openai"
          ? await openaiTranscript(input, bytes)
          : undefined;
        const text = (openai ?? await deepgramTranscript(input, apiKey, bytes)).trim();
        if (!text)
          throw new DeepgramVoiceError("No speech was detected. Record another turn.", 400);
        turn.user = message(turn, "user", text);
      } catch (error) {
        if (error instanceof DeepgramVoiceError) throw error;
        throw new DeepgramVoiceError("The recording could not be transcribed. Try this voice turn again.");
      }
    }
    if (!turn.userSaved) {
      try {
        await dependencies.save([turn.user], turn);
        turn.userSaved = true;
      } catch {
        return partial(turn, "Your voice transcript could not be saved. Retry this voice turn.");
      }
      for (const listener of turn.listeners) notify(listener, turn.user);
    }
    if (!turn.assistant) {
      try {
        const text = (await dependencies.generate(
          [...input.messages.filter((m) => m.id !== turn.user!.id), turn.user],
          input.context,
          AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        )).trim();
        if (!text || text.length > 8000) throw new Error("Invalid generated reply.");
        turn.assistant = message(turn, "assistant", text);
      } catch {
        return partial(turn, "Your transcript was saved, but the reply could not be generated. Try speaking again or continue by text.");
      }
    }
    if (!turn.assistantSaved) {
      try {
        await dependencies.save([turn.assistant], turn);
        turn.assistantSaved = true;
      } catch {
        return partial(turn, "Your transcript was saved, but the reply could not be saved. Try speaking again or continue by text.");
      }
      for (const listener of turn.listeners) notify(listener, turn.assistant);
    }
    return {
      status: "success" as const,
      sessionId: turn.sessionId,
      persisted: true,
      messages: [turn.user, turn.assistant],
    };
  }
  return {
    async turn(
      raw: Turn,
      identity: string,
      onMessage?: (message: DeepgramMessage) => void,
    ): Promise<DeepgramTurnResult> {
      const input = deepgramTurnSchema.parse(raw);
      if (!identity) throw new DeepgramVoiceError("Invalid conversation identity.", 403);
      const bytes = audioBytes(input.audioBase64);
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const now = Date.now();
      for (const [id, cached] of turns)
        if (!cached.pending && cached.expiresAt < now) turns.delete(id);
      let turn = turns.get(input.turnId);
      if (turn && (turn.resourceId !== identity || turn.threadId !== input.threadId || turn.fingerprint !== fingerprint))
        throw new DeepgramVoiceError("This voice turn identifier is already in use. Start a new recording.", 409);
      // A joining retry first hears what is already saved, then any later message.
      const replay = (cached: CachedTurn) => {
        if (!onMessage) return;
        if (cached.userSaved && cached.user) notify(onMessage, cached.user);
        if (cached.assistantSaved && cached.assistant) notify(onMessage, cached.assistant);
      };
      if (turn?.pending) {
        replay(turn);
        if (onMessage) turn.listeners.add(onMessage);
        return turn.pending;
      }
      if (turn?.result?.status === "success") {
        replay(turn);
        return turn.result;
      }
      const apiKey = dependencies.apiKey()?.trim();
      if (!apiKey) throw new DeepgramVoiceError("Deepgram voice is not configured on the server.", 503);
      if (!turn) {
        // Retain every ID until expiry so eviction cannot re-run a billed turn.
        if (turns.size >= CACHE_LIMIT)
          throw new DeepgramVoiceError("Voice turn capacity reached. Try again later.", 429);
        turn = { fingerprint, threadId: input.threadId, resourceId: identity,
          expiresAt: now + CACHE_TTL_MS, sessionId: "deepgram-" + input.turnId,
          userSaved: false, assistantSaved: false, listeners: new Set(), speechRequests: 0 };
      }
      const release = dependencies.reserve?.(identity);
      turns.set(input.turnId, turn);
      const cached = turn;
      replay(cached);
      if (onMessage) cached.listeners.add(onMessage);
      // Do not link this work to a browser disconnect: Stop/End await the saved
      // transcript, and retrying the same ID joins this exact in-flight turn.
      cached.pending = processTurn(input, cached, apiKey, bytes).then((result) => {
        cached.result = result;
        return result;
      }).finally(() => {
        cached.pending = undefined;
        cached.listeners.clear();
        release?.();
      });
      return cached.pending;
    },
    // Streams the saved reply's audio. The turn's reservation already covers it.
    async speech(raw: z.infer<typeof deepgramSpeechSchema>, identity: string) {
      const input = deepgramSpeechSchema.parse(raw);
      const turn = turns.get(input.turnId);
      if (!turn) throw new DeepgramVoiceError("This voice reply is no longer available. Its text is saved.", 404);
      if (turn.resourceId !== identity || turn.threadId !== input.threadId)
        throw new DeepgramVoiceError("This voice reply is unavailable.", 403);
      if (!turn.assistantSaved || !turn.assistant)
        throw new DeepgramVoiceError("The voice reply is not ready yet.", 409);
      const apiKey = dependencies.apiKey()?.trim();
      if (!apiKey) throw new DeepgramVoiceError("Deepgram voice is not configured on the server.", 503);
      if (++turn.speechRequests > SPEECH_LIMIT)
        throw new DeepgramVoiceError("This reply's audio was requested too many times. Its text is saved.", 429);
      // The fallback below is part of this same counted request.
      const provider = dependencies.ttsProvider?.()?.trim().toLowerCase();
      const pcm =
        provider === "gemini" ? await geminiSpeech(turn.assistant.content)
        : provider === "openai" ? await openaiSpeech(turn.assistant.content)
        : undefined;
      if (pcm) return { body: pcm, mimeType: PCM_MIME_TYPE };
      let response: Response;
      try {
        const url = new URL("https://api.deepgram.com/v1/speak");
        url.searchParams.set("model", dependencies.ttsModel?.()?.trim() || "aura-2-orion-en");
        url.searchParams.set("encoding", "mp3");
        response = await request(url, {
          method: "POST",
          headers: { Authorization: "Token " + apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ text: turn.assistant.content }),
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          redirect: "error",
        });
      } catch {
        throw new DeepgramVoiceError("The audio reply could not be generated. Its text is saved.");
      }
      if (!response.ok || !response.body || !/^audio\/(?:mpeg|mp3)(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) {
        void response.body?.cancel().catch(() => {});
        throw new DeepgramVoiceError("The audio reply could not be generated. Its text is saved.");
      }
      return {
        body: response.body.pipeThrough(byteLimit(DEEPGRAM_AUDIO_BYTE_LIMIT)),
        mimeType: "audio/mpeg" as const,
      };
    },
  };
}
