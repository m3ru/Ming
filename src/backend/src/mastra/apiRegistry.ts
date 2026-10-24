import { registerApiRoute } from "@mastra/core/server";
import {
  ChatInputSchema,
  ChatOutput,
  chatWorkflow,
} from "./workflows/chatWorkflow";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createSSEStream } from "../utils/streamUtils";
import { liveVoice } from "./liveVoice";
import { scoreSentiment } from "./sentiment";
import { sentimentRequestSchema } from "../lib/sentiment";
import {
  VoiceError,
  voiceSessionSchema,
  voiceDelegationSchema,
  voiceUpdateSchema,
} from "../lib/voice";
import { z } from "zod";

// Helper function to convert Zod schema to OpenAPI schema
function toOpenApiSchema(schema: Parameters<typeof zodToJsonSchema>[0]) {
  return zodToJsonSchema(schema) as Record<string, unknown>;
}

/**
 * API routes for the Mastra backend
 *
 * These routes handle chat interactions between the Cedar-OS frontend
 * and your Mastra agents. The chat UI will automatically use these endpoints.
 *
 * - /chat: Standard request-response chat endpoint
 * - /chat/stream: Server-sent events (SSE) endpoint for streaming responses
 */
export const apiRoutes = [
  registerApiRoute("/sentiment", {
    method: "POST",
    handler: async (c) => {
      try {
        const request = sentimentRequestSchema.safeParse(await c.req.json());
        if (!request.success)
          return c.json({ error: "Invalid sentiment request." }, 400);
        if (!process.env.OPENAI_API_KEY)
          return c.json(
            { error: "OpenAI is not configured on the server." },
            503,
          );
        return c.json(
          await scoreSentiment(
            request.data.text,
            AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(20000)]),
          ),
        );
      } catch (error) {
        if (error instanceof SyntaxError)
          return c.json({ error: "Invalid sentiment request." }, 400);
        console.error(
          "Sentiment scoring failed",
          error instanceof Error ? error.name : "Unknown error",
        );
        return c.json({ error: "Sentiment scoring is unavailable." }, 502);
      }
    },
  }),
  registerApiRoute("/chat/stream", {
    method: "POST",
    openapi: {
      requestBody: {
        content: {
          "application/json": {
            schema: toOpenApiSchema(ChatInputSchema),
          },
        },
      },
    },
    handler: async (c) => {
      try {
        const body = await c.req.json();
        const {
          prompt,
          temperature,
          maxTokens,
          systemPrompt,
          additionalContext,
          resourceId,
          threadId,
        } = ChatInputSchema.parse(body);

        return createSSEStream(async (controller) => {
          const run = await chatWorkflow.createRunAsync();
          const result = await run.start({
            inputData: {
              prompt,
              temperature,
              maxTokens,
              systemPrompt,
              streamController: controller,
              additionalContext,
              resourceId,
              threadId,
            },
          });

          if (result.status !== "success") {
            // TODO: Handle workflow errors appropriately
            throw new Error(`Workflow failed: ${result.status}`);
          }
        });
      } catch (error) {
        console.error(error);
        return c.json(
          { error: error instanceof Error ? error.message : "Internal error" },
          500,
        );
      }
    },
  }),
  ...[
    {
      path: "/voice/session",
      schema: voiceSessionSchema,
      run: async (body: unknown, _token: string) =>
        liveVoice.create(voiceSessionSchema.parse(body)),
    },
    {
      path: "/voice/delegate",
      schema: voiceDelegationSchema,
      run: async (body: unknown, token: string) =>
        liveVoice.delegate(voiceDelegationSchema.parse(body), token),
    },
    {
      path: "/voice/sync",
      schema: voiceUpdateSchema,
      run: async (body: unknown, token: string) =>
        liveVoice.sync(voiceUpdateSchema.parse(body), token),
    },
  ].map(({ path, run }) =>
    registerApiRoute(path, {
      method: "POST",
      handler: async (c) => {
        try {
          const raw = await c.req.text();
          if (Buffer.byteLength(raw) > 512000)
            return c.json({ error: "Voice request is too large" }, 413);
          const body = JSON.parse(raw);
          const token =
            c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
          return c.json(await run(body, token));
        } catch (error) {
          if (error instanceof z.ZodError || error instanceof SyntaxError)
            return c.json({ error: "Invalid voice request" }, 400);
          if (error instanceof VoiceError)
            return c.json({ error: error.message }, error.status);
          console.error(
            "Voice request failed",
            error instanceof Error ? error.name : "Unknown error",
          );
          return c.json(
            {
              error:
                "Voice request failed. Check the server configuration and try again.",
            },
            502,
          );
        }
      },
    }),
  ),
];
