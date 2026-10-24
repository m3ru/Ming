import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

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
export const voiceSessionSchema = z.object({
  sdp: z.string().min(1).max(64000),
  threadId: z.string().min(1).max(256),
  resourceId: z.string().min(1).max(256),
  context: z.record(z.unknown()),
  messages: z.array(voiceMessageSchema).max(128),
});
export const voiceUpdateSchema = z.object({
  sessionId: z.string().min(1).max(256),
  messages: z.array(voiceMessageSchema).max(256),
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
  replies: Map<string, Promise<string>>;
};
type Dependencies = {
  apiKey: () => string | undefined;
  request?: typeof fetch;
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
  const request = dependencies.request ?? fetch;
  function authorize(id: string, token: string) {
    const session = sessions.get(id);
    if (!session || session.expiresAt < Date.now()) {
      sessions.delete(id);
      throw new VoiceError(
        "Voice session expired. Start a new conversation.",
        401,
      );
    }
    const supplied = Buffer.from(token),
      expected = Buffer.from(session.token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new VoiceError("Invalid voice session.", 403);
    return session;
  }
  return {
    async create(input: z.infer<typeof voiceSessionSchema>) {
      const apiKey = dependencies.apiKey();
      if (!apiKey)
        throw new VoiceError(
          "Set OPENAI_API_KEY in the root .env and restart the backend.",
          503,
        );
      for (const [id, session] of sessions)
        if (session.expiresAt < Date.now()) sessions.delete(id);
      if (sessions.size >= 100)
        throw new VoiceError("Too many voice sessions. Try again later.", 429);
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
              audio: { output: { voice: "marin" } },
              delegation: { type: "client" },
              instructions: coach
                ? "You are a concise, supportive communication coach. Speak English. Your backend has the user's transcript, scores, and feedback. Delegate questions needing those records. Use its results without inventing feedback. Listen to corrections and allow interruptions."
                : "You are Bart, an employee in a workplace management training role-play. Speak English in short, natural replies. Be initially defensive and frustrated, but respond to empathy. Stay in character. Your backend has the scenario and documents. Delegate factual questions about the scenario, documents, or your performance. Use its results and do not invent facts. Listen to corrections and allow interruptions.",
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
        expiresAt: Date.now() + 90 * 60 * 1000,
        replies: new Map(),
      });
      return { sessionId: result.session.id, sdp: result.transport.sdp, token };
    },
    async delegate(
      input: z.infer<typeof voiceDelegationSchema>,
      token: string,
    ) {
      const session = authorize(input.sessionId, token);
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
      return { delegationId: input.delegationId, text: await reply };
    },
    async sync(input: z.infer<typeof voiceUpdateSchema>, token: string) {
      const session = authorize(input.sessionId, token);
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
  };
}
