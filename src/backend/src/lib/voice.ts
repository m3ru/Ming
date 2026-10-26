import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { scenarioRoleplayPrompt } from "./prompts";

export const voiceMessageSchema = z.object({
  id: z.string().min(1).max(256),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(32000),
  createdAt: z.string().datetime(),
  metadata: z
    .object({
      source: z.literal("live-voice"),
      sessionId: z.string().min(1).max(256),
      fragments: z
        .array(
          z.object({
            event_id: z.string().min(1).max(256),
            role: z.enum(["user", "assistant"]),
            delta: z.string().max(8000),
            start_ms: z.number().finite().nonnegative(),
            end_ms: z.number().finite().nonnegative(),
          }),
        )
        .max(512),
    })
    .optional(),
});
export type VoiceMessage = z.infer<typeof voiceMessageSchema>;
// OpenAI Live takes at most 500 tokens per commentary append, and the browser sends each
// draft as one append. The model's output cap now includes reasoning, so it no longer bounds this.
// shortcut: bytes stand in for tokens (English runs ~4 bytes a token); add a tokenizer for other scripts.
const LIVE_DRAFT_BYTES = 1200;
export function liveDraft(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= LIVE_DRAFT_BYTES) return text;
  // A multi-byte character cut in half decodes to U+FFFD; drop it.
  const head = new TextDecoder()
    .decode(bytes.slice(0, LIVE_DRAFT_BYTES))
    .replace(/\uFFFD$/, "");
  // End on the last full sentence, else the last full word.
  const sentence = head.match(/^[\s\S]*[.!?…](?=\s|$)/)?.[0];
  const space = head.lastIndexOf(" ");
  return sentence || (space > 0 ? head.slice(0, space).trimEnd() : head);
}
// A browser must renew its media slot. Lost unload requests and crashed tabs
// therefore cannot consume the two-session allowance for the recovery window.
export const VOICE_LEASE_MS = 60_000;
const TRANSCRIPT_RECOVERY_MS = 90 * 60_000;
export const voiceSessionSchema = z.object({
  sdp: z.string().min(1).max(64000),
  threadId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9:_-]+$/)
    .refine(
      (id) => !id.startsWith("analysis-"),
      "Reserved conversation identifier.",
    ),
  resourceId: z.string().min(1).max(256),
  context: z.record(z.unknown()),
  messages: z.array(voiceMessageSchema).max(128),
});
export const voiceUpdateSchema = z.object({
  sessionId: z.string().min(1).max(256),
  messages: z.array(voiceMessageSchema).max(128),
});
export const voiceDelegationSchema = voiceUpdateSchema.extend({
  delegationId: z.string().min(1).max(256),
  context: z.record(z.unknown()),
});
export class VoiceError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 403 | 409 | 429 | 502 | 503 = 502,
  ) {
    super(message);
  }
}
type Session = {
  token: string;
  threadId: string;
  resourceId: string;
  context: Record<string, unknown>;
  expiresAt: number;
  leaseExpiresAt: number;
  released: boolean;
  replies: Map<string, Promise<string>>;
};
type Dependencies = {
  apiKey: () => string | undefined;
  request?: typeof fetch;
  now?: () => number;
  generate: (
    messages: VoiceMessage[],
    context: Record<string, unknown>,
  ) => Promise<string>;
  save: (
    messages: VoiceMessage[],
    scope: { threadId: string; resourceId: string },
  ) => Promise<void>;
};
export function chatType(context: Record<string, unknown>) {
  const value = context.chatType as { data?: unknown } | undefined;
  return value?.data === "transcript" ? "transcript" : "scenario";
}
// Bound by UTF-8 bytes, which conservatively bounds the startup token count.
function historyInput(
  messages: VoiceMessage[],
  context: Record<string, unknown>,
) {
  let remaining = 6000;
  const details = context.scenarioDetails as
    | { data?: { title?: string; situation?: string; companyDetails?: string } }
    | undefined;
  const summary = details?.data;
  const contextText = summary
    ? JSON.stringify({
        title: summary.title,
        situation: summary.situation,
        companyDetails: summary.companyDetails,
      }).slice(0, 1000)
    : "Scenario details and documents are available through the backend.";
  const result = [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: contextText }],
    },
  ];
  remaining -= Buffer.byteLength(contextText, "utf8");
  const history = [];
  for (const message of [...messages].reverse()) {
    if (!message.content.trim()) continue;
    const size = Buffer.byteLength(message.content, "utf8");
    if (size > remaining) break;
    remaining -= size;
    history.unshift({
      type: "message",
      role: message.role,
      content: [
        {
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: message.content,
        },
      ],
    });
  }
  return [...result, ...history];
}
export function createLiveVoiceService(dependencies: Dependencies) {
  const sessions = new Map<string, Session>();
  const pending = new Map<string, number>();
  let pendingCount = 0;
  const request = dependencies.request ?? fetch;
  const now = dependencies.now ?? Date.now;
  function authorize(
    id: string,
    token: string,
    identity: string,
    live = false,
  ) {
    const session = sessions.get(id);
    if (!session || session.expiresAt <= now()) {
      sessions.delete(id);
      throw new VoiceError(
        "Voice session expired. Start a new conversation.",
        401,
      );
    }
    const supplied = Buffer.from(token),
      expected = Buffer.from(session.token);
    if (
      !identity ||
      session.resourceId !== identity ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new VoiceError("Invalid voice session.", 403);
    if (live && (session.released || session.leaseExpiresAt <= now()))
      throw new VoiceError(
        "Voice connection expired. Reconnect to continue.",
        409,
      );
    return session;
  }
  return {
    async create(input: z.infer<typeof voiceSessionSchema>, identity: string) {
      if (!identity || input.resourceId !== identity)
        throw new VoiceError("Invalid conversation identity.", 403);
      const apiKey = dependencies.apiKey();
      if (!apiKey)
        throw new VoiceError(
          "Set OPENAI_API_KEY in the root .env and restart the backend.",
          503,
        );
      for (const [id, session] of sessions)
        if (session.expiresAt <= now()) sessions.delete(id);
      const live = [...sessions.values()].filter(
        (session) => !session.released && session.leaseExpiresAt > now(),
      );
      const owned = live.filter(
        (session) => session.resourceId === identity,
      ).length;
      if (
        live.length + pendingCount >= 100 ||
        sessions.size + pendingCount >= 2000 ||
        owned + (pending.get(identity) ?? 0) >= 2
      )
        throw new VoiceError("Too many voice sessions. Try again later.", 429);
      // Reserve before the first provider await; concurrent offers cannot all
      // pass the capacity check before their sessions enter the map.
      pendingCount++;
      pending.set(identity, (pending.get(identity) ?? 0) + 1);
      try {
        const coach = chatType(input.context) === "transcript";
        const response = await request(
          "https://api.openai.com/v1/live/sessions",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + apiKey,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify({
              session: {
                model: "gpt-live-1",
                audio: { output: { voice: "cedar" } },
                delegation: { type: "client" },
                instructions: coach
                  ? "You are a concise, supportive communication coach. Speak English. Your backend has the user's transcript, scores, and feedback. Delegate questions needing those records. Use its results without inventing feedback. Listen to corrections and allow interruptions."
                  : scenarioRoleplayPrompt(input.context) + "\nSpeak English. Your backend has the scenario and documents. Delegate factual questions about the scenario or documents. Use its results and do not invent facts. Listen to corrections and allow interruptions.",
                input: historyInput(input.messages, input.context),
              },
              transport: { type: "webrtc", sdp: input.sdp },
            }),
          },
        );
        if (!response.ok) {
          // Do not expose provider bodies, which can include credentials.
          console.error("OpenAI Live session failed", response.status);
          throw new VoiceError(
            "OpenAI Live could not start (HTTP " +
              response.status +
              "). Check that your project has GPT-Live access and API credits.",
            response.status === 429 ? 429 : 502,
          );
        }
        const result = z
          .object({
            session: z.object({ id: z.string() }),
            transport: z.object({ sdp: z.string() }),
          })
          .parse(await response.json());
        const token = randomUUID();
        sessions.set(result.session.id, {
          token,
          threadId: input.threadId,
          resourceId: input.resourceId,
          context: input.context,
          expiresAt: now() + TRANSCRIPT_RECOVERY_MS,
          leaseExpiresAt: now() + VOICE_LEASE_MS,
          released: false,
          replies: new Map(),
        });
        return {
          sessionId: result.session.id,
          sdp: result.transport.sdp,
          token,
        };
      } finally {
        pendingCount--;
        const remaining = (pending.get(identity) ?? 1) - 1;
        if (remaining) pending.set(identity, remaining);
        else pending.delete(identity);
      }
    },
    async delegate(
      input: z.infer<typeof voiceDelegationSchema>,
      token: string,
      identity: string,
    ) {
      const session = authorize(input.sessionId, token, identity, true);
      let reply = session.replies.get(input.delegationId);
      if (!reply) {
        if (session.replies.size >= 256)
          throw new VoiceError(
            "Voice conversation is too long. Start a new session.",
            409,
          );
        session.context = input.context;
        reply = dependencies.generate(input.messages, session.context);
        session.replies.set(input.delegationId, reply);
        void reply.catch(() => session.replies.delete(input.delegationId));
      }
      return { delegationId: input.delegationId, text: liveDraft(await reply) };
    },
    async sync(
      input: z.infer<typeof voiceUpdateSchema>,
      token: string,
      identity: string,
    ) {
      const session = authorize(input.sessionId, token, identity);
      if (
        input.messages.some(
          (message) => !message.id.startsWith("voice-" + input.sessionId + "-"),
        )
      )
        throw new VoiceError(
          "Transcript does not belong to this voice session.",
          403,
        );
      await dependencies.save(input.messages, session);
      return { saved: true };
    },
    async end(sessionId: string, token: string, identity: string) {
      const session = authorize(sessionId, token, identity);
      // Releasing media capacity must not discard a failed final transcript save.
      // The capability remains restricted to this identity and transcript scope.
      session.released = true;
      session.replies.clear();
      return { ended: true };
    },
    async heartbeat(sessionId: string, token: string, identity: string) {
      const session = authorize(sessionId, token, identity, true);
      session.leaseExpiresAt = now() + VOICE_LEASE_MS;
      return { renewed: true };
    },
  };
}
