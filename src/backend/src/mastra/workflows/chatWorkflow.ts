// ---------------------------------------------
// Workflows are a Mastra primitive to orchestrate agents and complex sequences of tasks
// Docs: https://mastra.ai/en/docs/workflows/overview
// ---------------------------------------------

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { RuntimeContext } from "@mastra/core/di";
import { z } from "zod";
import type { MastraMessageV2 } from "@mastra/core/agent";
import {
  ChatStreamError,
  handleTextStream,
  streamJSONEvent,
} from "../../utils/streamUtils";
import { ActionSchema } from "./chatWorkflowTypes";
import { defaultAgent } from "../agents/defaultAgent";
import { resolveTextProvider } from "../../lib/providers";

export const ChatInputSchema = z.object({
  prompt: z.string().trim().min(1).max(16000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(2048).default(768),
  systemPrompt: z.string().max(16000).optional(),
  streamController: z.instanceof(ReadableStreamDefaultController).optional(),
  additionalContext: z.any().optional(),
  resourceId: z.string().optional(),
  threadId: z.string().optional(),
});

export const ChatOutputSchema = z.object({
  content: z.string(),
  // TODO: Add any structured output fields your application needs
  object: ActionSchema.optional(),
  usage: z.any().optional(),
});

export type ChatOutput = z.infer<typeof ChatOutputSchema>;

const callAgent = createStep({
  id: "callAgent",
  description: "Invoke the chat agent with the user prompt using streamVNext",
  inputSchema: ChatInputSchema,
  outputSchema: ChatOutputSchema,
  execute: async ({ inputData }) => {
    const {
      prompt,
      temperature,
      maxTokens,
      streamController,
      additionalContext,
      resourceId,
      threadId,
    } = inputData;

    if (!streamController) {
      throw new Error("Stream controller is required");
    }

    // Create runtime context with additionalContext and streamController
    const runtimeContext = new RuntimeContext();
    runtimeContext.set("additionalContext", additionalContext);
    runtimeContext.set("streamController", streamController);

    // Check if we need to prepend a system prompt based on context
    let modifiedPrompt = prompt;
    let censor = (text: string) => text;
    let pendingText = "";
    // Look for chatType in the subscribed context data
    let chatType = null;
    if (additionalContext) {
      // Cedar sends subscribed context as { data: value, source: 'subscription' }
      if (additionalContext.chatType && additionalContext.chatType.data) {
        chatType = additionalContext.chatType.data;
      }
    }
    if (chatType === "scenario") {
      const { scenarioRoleplayPrompt, censorBartSpeech } = await import("../../lib/prompts");
      censor = censorBartSpeech;
      modifiedPrompt = `${scenarioRoleplayPrompt(additionalContext)}\n\nUser: ${prompt}`;
    } else if (chatType === "transcript") {
      const { feedbackReplyPrompt } = await import("../../lib/prompts");

      // Check if the combined prompt would be too long
      const combinedLength =
        feedbackReplyPrompt.length +
        prompt.length +
        JSON.stringify(additionalContext).length;

      if (combinedLength > 120000) {
        // Conservative limit
        modifiedPrompt = `You are a communication coach helping analyze workplace performance. Answer questions about communication skills, empathy, and conflict management based on the conversation analysis provided.\n\nUser: ${prompt}`;
      } else {
        modifiedPrompt = `${feedbackReplyPrompt}\n\nUser: ${prompt}`;
      }
    }

    const userMessage: MastraMessageV2 = {
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      content: { format: 2, parts: [{ type: "text", text: prompt }] },
      createdAt: new Date(),
      threadId,
      resourceId,
    };
    let responseText = "";
    /**
     * Using Mastra streamVNext for enhanced streaming capabilities.
     * streamVNext returns a stream result that we can iterate over to get chunks
     * and properly handle different event types such as text-delta, tool calls, etc.
     */

    try {
      if (threadId && resourceId) {
        const memory = await defaultAgent.getMemory();
        if (memory) {
          const thread = await memory.getThreadById({ threadId });
          if (thread && thread.resourceId !== resourceId) {
            throw new ChatStreamError("PROVIDER_UNAVAILABLE");
          }
          if (!thread) {
            await memory.createThread({
              threadId,
              resourceId,
              title: "Practice conversation",
            });
          }
          // Mastra saves on successful completion, so save the user's actual
          // words first. Supplying the same ID below avoids a duplicate on
          // success and keeps the latest turn available after provider errors.
          await memory.saveMessages({ format: "v2", messages: [userMessage] });
        }
      }
      const streamResult = await defaultAgent.streamVNext([userMessage], {
        instructions:
          modifiedPrompt +
          "\n\nAdditional context (for background knowledge): " +
          JSON.stringify(additionalContext),
        modelSettings: {
          temperature,
          // GPT-6 Luna's medium-effort reasoning counts against this cap; keep the reply budget.
          maxOutputTokens:
            resolveTextProvider().provider === "openai" ? maxTokens + 4096 : maxTokens,
        },
        runtimeContext,
        ...(threadId && resourceId
          ? {
              memory: {
                thread: threadId,
                resource: resourceId,
              },
            }
          : {}),
      });

      // Mastra may yield provider errors as chunks instead of rejecting the
      // iterator. Ignoring them turns a failed response into an empty success.
      for await (const chunk of streamResult.fullStream) {
        if (
          chunk.type === "error" ||
          chunk.type === "abort" ||
          chunk.type === "tripwire"
        ) {
          throw new ChatStreamError("PROVIDER_UNAVAILABLE");
        }
        if (chunk.type === "text-delta") {
          // Hold the trailing word so a swear split across provider tokens is
          // censored before any part reaches the client.
          pendingText += chunk.payload.text;
          const boundary = pendingText.search(/\S*$/);
          const ready = censor(pendingText.slice(0, boundary));
          pendingText = pendingText.slice(boundary);
          if (ready) await handleTextStream(ready, streamController);
          responseText += ready;
        } else if (chunk.type === "tool-result" || chunk.type === "tool-call") {
          streamJSONEvent(streamController, chunk.type, chunk);
        }
      }

      const tail = censor(pendingText);
      if (tail) await handleTextStream(tail, streamController);
      responseText += tail;
      if (!responseText.trim()) throw new ChatStreamError("EMPTY_RESPONSE");
      const usage = await streamResult.usage;
      return { content: responseText, usage };
    } catch (error) {
      // Do not attach the raw provider error as a cause: workflow diagnostics
      // can serialize it, including request data and credentials.
      throw error instanceof ChatStreamError
        ? error
        : new ChatStreamError("PROVIDER_UNAVAILABLE");
    }
  },
});

export const chatWorkflow = createWorkflow({
  id: "chatWorkflow",
  description:
    "Chat workflow that handles agent interactions with optional streaming support",
  inputSchema: ChatInputSchema,
  outputSchema: ChatOutputSchema,
})
  .then(callAgent)
  .commit();
