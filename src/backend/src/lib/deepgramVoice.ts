import { createHash } from "node:crypto";
import { z } from "zod";
import { voiceSessionSchema, type VoiceMessage } from "./voice";

export const DEEPGRAM_AUDIO_BYTE_LIMIT = 1024 * 1024;
const PROVIDER_JSON_BYTE_LIMIT = 256 * 1024;
// IDs are kept for the TTL so a retry never re-bills a turn. 512 per 15 minutes is far
// above the hourly quota's 200 turns; only the newest replies keep their (~1 MB) audio.
const CACHE_LIMIT = 512;
const CACHE_TTL_MS = 15 * 60_000;
const AUDIO_KEEP = 8;
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
  audioBase64?: string;
  audioMimeType?: "audio/mpeg" | "audio/wav";
  error?: string;
};
export class DeepgramVoiceError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 409 | 413 | 429 | 502 | 503 = 502,
  ) {
    super(message);
  }
}
type Dependencies = {
  apiKey: () => string | undefined;
  sttModel?: () => string | undefined;
  ttsModel?: () => string | undefined;
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
  async function processTurn(input: Turn, turn: CachedTurn, apiKey: string, bytes: Buffer) {
    if (!turn.user) {
      try {
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
        const text = result.results.channels[0].alternatives[0]?.transcript.trim();
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
    }
    try {
      if (/\bBEEP\b/.test(turn.assistant.content)) {
        const parts = turn.assistant.content.split(/\bBEEP\b/);
        if (parts.length > 25) throw new Error("Too many censor markers.");
        const sampleRate = 24000;
        const beep = Buffer.alloc(sampleRate * 0.3 * 2);
        for (let i = 0; i < beep.length / 2; i++) {
          // A short envelope prevents clicks at the boundaries of the tone.
          const edge = Math.min(1, i / 120, (beep.length / 2 - 1 - i) / 120);
          beep.writeInt16LE(Math.round(6000 * edge * Math.sin(2 * Math.PI * 1000 * i / sampleRate)), i * 2);
        }
        const chunks: Buffer[] = [];
        const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
        let total = 0;
        for (let i = 0; i < parts.length; i++) {
          if (i) { chunks.push(beep); total += beep.length; }
          if (parts[i].trim()) {
            const url = new URL("https://api.deepgram.com/v1/speak");
            url.searchParams.set("model", dependencies.ttsModel?.()?.trim() || "aura-2-thalia-en");
            url.searchParams.set("encoding", "linear16");
            url.searchParams.set("container", "none");
            url.searchParams.set("sample_rate", String(sampleRate));
            const response = await request(url, {
              method: "POST",
              headers: { Authorization: "Token " + apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({ text: parts[i] }), signal, redirect: "error",
            });
            if (!response.ok || !/^audio\/(?:l16|linear16|pcm)(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) {
              void response.body?.cancel().catch(() => {});
              throw new Error("Speech request failed.");
            }
            const pcm = await boundedBody(response, 4 * DEEPGRAM_AUDIO_BYTE_LIMIT - total);
            if (!pcm.length || pcm.length % 2) throw new Error("Invalid PCM output.");
            chunks.push(pcm); total += pcm.length;
          }
          if (total > 4 * DEEPGRAM_AUDIO_BYTE_LIMIT) throw new Error("Speech output exceeded limit.");
        }
        const header = Buffer.alloc(44);
        header.write("RIFF"); header.writeUInt32LE(36 + total, 4);
        header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
        header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
        header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
        header.write("data", 36); header.writeUInt32LE(total, 40);
        return {
          status: "success" as const, sessionId: turn.sessionId, persisted: true,
          messages: [turn.user, turn.assistant],
          audioBase64: Buffer.concat([header, ...chunks]).toString("base64"),
          audioMimeType: "audio/wav" as const,
        };
      }
      const url = new URL("https://api.deepgram.com/v1/speak");
      url.searchParams.set("model", dependencies.ttsModel?.()?.trim() || "aura-2-thalia-en");
      url.searchParams.set("encoding", "mp3");
      const response = await request(url, {
        method: "POST",
        headers: { Authorization: "Token " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text: turn.assistant.content }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        redirect: "error",
      });
      if (!response.ok || !/^audio\/(?:mpeg|mp3)(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Speech request failed.");
      }
      const audio = await boundedBody(response, DEEPGRAM_AUDIO_BYTE_LIMIT);
      if (!audio.length) throw new Error("Empty speech output.");
      return {
        status: "success" as const,
        sessionId: turn.sessionId,
        persisted: true,
        messages: [turn.user, turn.assistant],
        audioBase64: audio.toString("base64"),
        audioMimeType: "audio/mpeg" as const,
      };
    } catch {
      return partial(turn, "The conversation was saved, but speech audio could not be generated. You can continue speaking or by text.");
    }
  }
  return {
    async turn(raw: Turn, identity: string): Promise<DeepgramTurnResult> {
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
      if (turn?.pending) return turn.pending;
      if (turn?.result?.status === "success") return turn.result;
      const apiKey = dependencies.apiKey()?.trim();
      if (!apiKey) throw new DeepgramVoiceError("Deepgram voice is not configured on the server.", 503);
      if (!turn) {
        // Retain every ID until expiry so eviction cannot re-run a billed turn.
        if (turns.size >= CACHE_LIMIT)
          throw new DeepgramVoiceError("Voice turn capacity reached. Try again later.", 429);
        turn = { fingerprint, threadId: input.threadId, resourceId: identity,
          expiresAt: now + CACHE_TTL_MS, sessionId: "deepgram-" + input.turnId,
          userSaved: false, assistantSaved: false };
      }
      const release = dependencies.reserve?.(identity);
      turns.set(input.turnId, turn);
      const cached = turn;
      // Do not link this work to a browser disconnect: Stop/End await the saved
      // transcript, and retrying the same ID joins this exact in-flight turn.
      cached.pending = processTurn(input, cached, apiKey, bytes).then((result) => {
        cached.result = result;
        // Older finished turns keep their text for retries but drop reply audio.
        let withAudio = 0;
        for (const old of [...turns.values()].reverse())
          if (old.result?.audioBase64 && ++withAudio > AUDIO_KEEP)
            old.result = { ...old.result, audioBase64: undefined, audioMimeType: undefined };
        return result;
      }).finally(() => {
        cached.pending = undefined;
        release?.();
      });
      return cached.pending;
    },
  };
}
