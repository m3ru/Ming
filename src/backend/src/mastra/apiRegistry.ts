import { registerApiRoute } from "@mastra/core/server";
import { ChatInputSchema, chatWorkflow } from "./workflows/chatWorkflow";
import { feedbackOrchestratorWorkflow } from "./workflows/feedbackOrchestratorWorkflow";
import { ScenarioPipelineInputSchema, ScenarioPipelineOutputSchema, scenarioPipelineWorkflow } from "./workflows/scenarioPipelineWorkflow";
import {
  ChatStreamError,
  createSSEStream,
  publicChatError,
} from "../utils/streamUtils";
import { liveVoice } from "./liveVoice";
import { deepgramVoice } from "./deepgramVoice";
import { deepgramSpeechSchema, deepgramTurnSchema, DeepgramVoiceError } from "../lib/deepgramVoice";
import { isTextConfigured } from "./models";
import { scoreSentiment } from "./sentiment";
import { sentimentRequestSchema } from "../lib/sentiment";
import {
  VoiceError,
  voiceSessionSchema,
  voiceDelegationSchema,
  voiceUpdateSchema,
} from "../lib/voice";
import {
  AccessError,
  analysisThread,
  claimThread,
  reserveGeneration,
  threadIdSchema,
  trustedIdentity,
} from "../lib/security";
import { z } from "zod";
import type { Context } from "hono";

const feedbackSchema = z.object({
  threadId: threadIdSchema,
  transcript: z.string().trim().min(1).max(96000),
  additionalContext: z.record(z.unknown()).optional(),
});
const scenarioRequestSchema = ScenarioPipelineInputSchema.pick({
  analysis: true,
  additionalContext: true,
}).extend({
  threadId: threadIdSchema,
});
const chatSchema = ChatInputSchema.extend({ threadId: threadIdSchema });
function errorResponse(c: Context, error: unknown) {
  if (error instanceof AccessError || error instanceof VoiceError || error instanceof DeepgramVoiceError)
    return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return c.json({ error: "Invalid request." }, 400);
  // Provider bodies and workflow diagnostics may contain private conversation
  // data. Never serialize or log them at this public application boundary.
  return c.json(
    { error: "The request could not be completed. Try again." },
    502,
  );
}
function configured() {
  if (!isTextConfigured())
    throw new AccessError(503, "AI is not configured on the server.");
}
function openaiVoiceConfigured() {
  if (!process.env.OPENAI_API_KEY?.trim())
    throw new AccessError(503, "OpenAI voice is not configured on the server.");
}

export const apiRoutes = [
  registerApiRoute("/sentiment", {
    method: "POST",
    handler: async (c) => {
      let release: (() => void) | undefined;
      try {
        const request = sentimentRequestSchema.parse(await c.req.json());
        configured();
        release = reserveGeneration(trustedIdentity(c));
        return c.json(
          await scoreSentiment(
            request.text,
            AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(20000)]),
          ),
        );
      } catch (error) {
        return errorResponse(c, error);
      } finally {
        release?.();
      }
    },
  }),
  registerApiRoute("/chat/stream", {
    method: "POST",
    handler: async (c) => {
      let release: (() => void) | undefined;
      try {
        const { prompt, temperature, maxTokens, additionalContext, threadId } =
          chatSchema.parse(await c.req.json());
        const resourceId = trustedIdentity(c);
        if (!isTextConfigured()) {
          const error = publicChatError(
            new ChatStreamError("AI_NOT_CONFIGURED"),
          );
          return c.json({ ...error, error: error.message }, 503);
        }
        release = reserveGeneration(resourceId);
        await claimThread(threadId, resourceId);
        const releaseStream = release;
        release = undefined;
        return createSSEStream(async (controller) => {
          try {
            const run = await chatWorkflow.createRunAsync();
            const result = await run.start({
              inputData: {
                prompt,
                temperature,
                maxTokens,
                streamController: controller,
                additionalContext,
                resourceId,
                threadId,
              },
            });
            if (result.status !== "success")
              throw new ChatStreamError("PROVIDER_UNAVAILABLE");
          } finally {
            releaseStream();
          }
        });
      } catch (error) {
        if (error instanceof AccessError) return errorResponse(c, error);
        const invalid =
          error instanceof z.ZodError || error instanceof SyntaxError;
        const safeError = publicChatError(
          invalid ? new ChatStreamError("INVALID_CHAT_REQUEST") : error,
        );
        return c.json(
          { ...safeError, error: safeError.message },
          invalid ? 400 : 502,
        );
      } finally {
        release?.();
      }
    },
  }),
  registerApiRoute("/feedback", {
    method: "POST",
    handler: async (c) => {
      let release: (() => void) | undefined;
      try {
        const input = feedbackSchema.parse(await c.req.json());
        const resourceId = trustedIdentity(c);
        configured();
        release = reserveGeneration(resourceId, 8);
        await claimThread(input.threadId, resourceId);
        const run = await feedbackOrchestratorWorkflow.createRunAsync();
        // The browser gives up at 120 s and the gateway at 150 s. Stop the model calls with
        // them, or an abandoned run keeps holding one of the four generation slots.
        const stop = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(150_000)]);
        const cancel = () => void run.cancel().catch(() => {});
        // An abort listener added after the abort never fires: a browser already gone stops here.
        stop.throwIfAborted();
        stop.addEventListener("abort", cancel, { once: true });
        const result = await run
          .start({
            inputData: {
              ...input,
              resourceId,
              threadId: analysisThread(input.threadId, resourceId),
            },
          })
          .finally(() => stop.removeEventListener("abort", cancel));
        if (result.status !== "success")
          return c.json(
            {
              status: "failed",
              error: "The report could not be generated. Try again.",
            },
            502,
          );
        const { summaryAnalysis, detailedFeedback, segmentedAnalysis } =
          result.result;
        return c.json({
          status: "success",
          result: { summaryAnalysis, detailedFeedback, segmentedAnalysis },
        });
      } catch (error) {
        return errorResponse(c, error);
      } finally {
        release?.();
      }
    },
  }),
  registerApiRoute("/scenario-next", {
    method: "POST",
    handler: async (c) => {
      let release: (() => void) | undefined;
      try {
        const input = scenarioRequestSchema.parse(await c.req.json());
        const resourceId = trustedIdentity(c);
        configured();
        release = reserveGeneration(resourceId, 8);
        await claimThread(input.threadId, resourceId);
        const run = await scenarioPipelineWorkflow.createRunAsync();
        const result = await run.start({
          inputData: {
            ...input,
            resourceId,
            threadId: analysisThread(input.threadId, resourceId),
          },
        });
        if (result.status !== "success")
          return c.json(
            {
              status: "failed",
              error: "The scenario could not be generated. Try again.",
            },
            502,
          );
        // Validate the public boundary too, so a future workflow change cannot
        // accidentally return raw generation strings or a partial scenario.
        const output = ScenarioPipelineOutputSchema.safeParse(result.result);
        if (!output.success)
          return c.json(
            { status: "failed", error: "The scenario could not be generated. Try again." },
            502,
          );
        return c.json({
          status: "success",
          result: { scenario: output.data.scenario },
        });
      } catch (error) {
        return errorResponse(c, error);
      } finally {
        release?.();
      }
    },
  }),
  registerApiRoute("/voice/deepgram/turn", {
    method: "POST",
    handler: async (c) => {
      try {
        if (process.env.MING_VOICE_PROVIDER?.trim().toLowerCase() !== "deepgram")
          return c.json({ error: "Deepgram voice is not enabled on the server." }, 404);
        const input = deepgramTurnSchema.parse(await c.req.json());
        const identity = trustedIdentity(c);
        if (!process.env.DEEPGRAM_API_KEY?.trim())
          throw new AccessError(503, "Deepgram voice is not configured on the server.");
        await claimThread(input.threadId, identity);
        // NDJSON: one line per saved message, then a final done or error line.
        // Failures before the first line (silence, 409, quota) stay JSON with their status.
        const encoder = new TextEncoder();
        let output!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start: (controller) => { output = controller; } });
        const send = (line: Record<string, unknown>) => {
          try {
            output.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
          } catch {
            // The browser left; the turn still completes and a retry joins it.
          }
        };
        let started!: () => void;
        const firstMessage = new Promise<void>((resolve) => { started = resolve; });
        const result = deepgramVoice.turn(input, identity, (message) => {
          send({ type: "message", message });
          started();
        });
        await Promise.race([firstMessage, result]);
        void result.then(
          ({ status, sessionId, persisted, error }) =>
            send({ type: "done", status, sessionId, persisted, ...(error ? { error } : {}) }),
          (error) => send(error instanceof DeepgramVoiceError
            ? { type: "error", status: error.status, error: error.message }
            : { type: "error", status: 502, error: "The request could not be completed. Try again." }),
        ).finally(() => {
          try {
            output.close();
          } catch {
            // Already cancelled by the browser.
          }
        });
        return c.body(body, 200, { "Content-Type": "application/x-ndjson" });
      } catch (error) {
        return errorResponse(c, error);
      }
    },
  }),
  registerApiRoute("/voice/deepgram/speech", {
    method: "POST",
    handler: async (c) => {
      try {
        if (process.env.MING_VOICE_PROVIDER?.trim().toLowerCase() !== "deepgram")
          return c.json({ error: "Deepgram voice is not enabled on the server." }, 404);
        const input = deepgramSpeechSchema.parse(await c.req.json());
        const identity = trustedIdentity(c);
        if (!process.env.DEEPGRAM_API_KEY?.trim())
          throw new AccessError(503, "Deepgram voice is not configured on the server.");
        const audio = await deepgramVoice.speech(input, identity);
        return c.body(audio.body, 200, { "Content-Type": audio.mimeType });
      } catch (error) {
        return errorResponse(c, error);
      }
    },
  }),
  ...["session", "delegate", "sync", "end", "heartbeat"].map((action) =>
    registerApiRoute("/voice/" + action, {
      method: "POST",
      handler: async (c) => {
        let release: (() => void) | undefined;
        try {
          const raw = await c.req.json();
          const identity = trustedIdentity(c);
          const token =
            c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
          if (action === "session") {
            const input = voiceSessionSchema.parse({
              ...raw,
              resourceId: identity,
            });
            openaiVoiceConfigured();
            release = reserveGeneration(identity, 12);
            await claimThread(input.threadId, identity);
            return c.json(await liveVoice.create(input, identity));
          }
          if (action === "delegate") {
            const input = voiceDelegationSchema.parse(raw);
            configured();
            release = reserveGeneration(identity);
            return c.json(await liveVoice.delegate(input, token, identity));
          }
          if (action === "end" || action === "heartbeat") {
            const input = z
              .object({ sessionId: z.string().min(1).max(256) })
              .parse(raw);
            return c.json(
              await liveVoice[action](input.sessionId, token, identity),
            );
          }
          return c.json(
            await liveVoice.sync(voiceUpdateSchema.parse(raw), token, identity),
          );
        } catch (error) {
          return errorResponse(c, error);
        } finally {
          release?.();
        }
      },
    }),
  ),
];
