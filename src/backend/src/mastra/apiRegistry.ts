import { registerApiRoute } from "@mastra/core/server";
import {
  ChatInputSchema,
  ChatOutput,
  chatWorkflow,
} from "./workflows/chatWorkflow";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createSSEStream } from "../utils/streamUtils";
import { handleVoiceRequest } from "../lib/voice";

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
          500
        );
      }
    },
  }),
  registerApiRoute("/chat/voice", {
    method: "POST",
    openapi: {
      requestBody: {
        content: {
          "application/form-data": {
            schema: {
              type: "object",
              properties: {
                audio: {
                  type: "string",
                  format: "binary",
                  description: "Audio file (WAV or MP3 format)",
                },
                context: {
                  type: "string",
                  description:
                    "JSON string with additional context for the conversation",
                },
              },
              required: ["audio", "context"],
            },
          },
        },
      },
    },
    handler: async (c) => {
      try {
        const formData = await c.req.formData();

        // console.log("Received form data:", formData);

        const audioFile = formData.get("audio") as File | null;
        const context = formData.get("context") as string | null;

        // console.log("Audio file:", audioFile);

        const audioBlob = audioFile
          ? audioFile.slice(0, audioFile.size, audioFile.type)
          : null;

        if (!audioBlob || !context) {
          return c.json(
            { error: "Missing 'audio' file or 'context' in form data" },
            400
          );
        }

        // console.log("Audio blob:", audioBlob);

        const result = await handleVoiceRequest(audioBlob, context);
        return c.json(result);
      } catch (error) {
        console.error(error);
        return c.json(
          { error: error instanceof Error ? error.message : "Internal error" },
          500
        );
      }
    },
  }),
];
