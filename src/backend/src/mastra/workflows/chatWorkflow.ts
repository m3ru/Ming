// ---------------------------------------------
// Workflows are a Mastra primitive to orchestrate agents and complex sequences of tasks
// Docs: https://mastra.ai/en/docs/workflows/overview
// ---------------------------------------------

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { RuntimeContext } from "@mastra/core/di";
import { z } from "zod";
import { helloWorldAgent } from "../agents/helloWorldAgent";
import { handleTextStream, streamJSONEvent } from "../../utils/streamUtils";
import { ActionSchema } from "./chatWorkflowTypes";
import { defaultAgent } from "../agents/defaultAgent";

export const ChatInputSchema = z.object({
  prompt: z.string(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  systemPrompt: z.string().optional(),
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
      systemPrompt,
      streamController,
      additionalContext,
      resourceId,
      threadId,
    } = inputData;

    if (!streamController) {
      throw new Error("Stream controller is required");
    }

    console.log("Chat workflow received input data", inputData);

    // Create runtime context with additionalContext and streamController
    const runtimeContext = new RuntimeContext();
    runtimeContext.set("additionalContext", additionalContext);
    runtimeContext.set("streamController", streamController);

    // Check if we need to prepend a system prompt based on context
    let modifiedPrompt = prompt;
    
    console.log("Checking additionalContext for chat type:", {
      fullContext: additionalContext,
      hasAdditionalContext: !!additionalContext
    });
    
    // Look for chatType in the subscribed context data
    let chatType = null;
    if (additionalContext) {
      // Cedar sends subscribed context as { data: value, source: 'subscription' }
      if (additionalContext.chatType && additionalContext.chatType.data) {
        chatType = additionalContext.chatType.data;
        console.log(`Found chatType '${chatType}' from Cedar subscription`);
      }
    }
    
    console.log("Prompt modification check:", {
      originalPrompt: prompt,
      detectedChatType: chatType,
      fullAdditionalContext: additionalContext
    });
    
    if (chatType === 'scenario' && !prompt.includes("senior software engineer")) {
      const { billPrompt } = await import('../../lib/prompts');
      modifiedPrompt = `${billPrompt}\n\nUser: ${prompt}`;
      console.log("Applied Bill prompt in workflow");
    } else if (chatType === 'transcript' && !prompt.includes("communication coach")) {
      const { feedbackReplyPrompt } = await import('../../lib/prompts');
      
      // Check if the combined prompt would be too long
      const combinedLength = feedbackReplyPrompt.length + prompt.length + JSON.stringify(additionalContext).length;
      console.log("Combined prompt length would be:", combinedLength);
      
      if (combinedLength > 120000) { // Conservative limit
        console.log("Prompt too long, using shorter version");
        modifiedPrompt = `You are a communication coach helping analyze workplace performance. Answer questions about communication skills, empathy, and conflict management based on the conversation analysis provided.\n\nUser: ${prompt}`;
      } else {
        modifiedPrompt = `${feedbackReplyPrompt}\n\nUser: ${prompt}`;
      }
      console.log("Applied feedback prompt in workflow");
    }

    const messages = [
      "User message: " + modifiedPrompt,
      "Additional context (for background knowledge): " +
        JSON.stringify(additionalContext),
    ];

    let responseText = "";
    /**
     * Using Mastra streamVNext for enhanced streaming capabilities.
     * streamVNext returns a stream result that we can iterate over to get chunks
     * and properly handle different event types such as text-delta, tool calls, etc.
     */
    const streamResult = await defaultAgent.streamVNext(messages, {
      // If system prompt is provided, overwrite the default system prompt for this agent
      ...(systemPrompt ? ({ instructions: systemPrompt } as const) : {}),
      modelSettings: {
        temperature,
        maxOutputTokens: maxTokens,
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

    console.log("Starting stream processing...");
    console.log("Modified prompt length:", modifiedPrompt.length);
    console.log("Modified prompt preview:", modifiedPrompt.substring(0, 300) + "...");
    
    // Process streaming chunks from streamVNext
    for await (const chunk of streamResult.fullStream) {
      console.log("Received chunk type:", chunk.type);
      
      if (chunk.type === "text-delta") {
        console.log("Text delta received:", chunk.payload.text);
        await handleTextStream(chunk.payload.text, streamController);
        responseText += chunk.payload.text;
      } else if (chunk.type === "tool-result" || chunk.type === "tool-call") {
        console.log("Tool chunk received:", chunk.type);
        streamJSONEvent(streamController, chunk.type, chunk);
      } else {
        console.log("Other chunk type:", chunk.type);
      }
    }

    console.log("Final responseText length:", responseText.length);
    console.log("Final responseText preview:", responseText.substring(0, 200));

    const usage = await streamResult.usage;

    console.log("Chat workflow result", {
      content: responseText,
      usage: usage,
    });

    return {
      content: responseText,
      usage: usage,
    };
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
