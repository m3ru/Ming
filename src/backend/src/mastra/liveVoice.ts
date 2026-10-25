import { Agent } from "@mastra/core/agent";
import { createLiveVoiceService, chatType, VoiceError } from "../lib/voice";
import { scenarioRoleplayPrompt, feedbackReplyPrompt } from "../lib/prompts";
import { defaultAgent } from "./agents/defaultAgent";
import { textModel } from "./models";

// Drafts are not stored as if spoken; only actual transcripts are saved below.
const voiceBackend = new Agent({
  name: "voice-backend",
  model: textModel,
  instructions:
    "Help a live voice conversation using the supplied records. Transcripts may be unfinished or contain corrections. Use the latest intent. Return a short answer for the speaking assistant, at most 100 words.",
});
export const liveVoice = createLiveVoiceService({
  apiKey: () => process.env.OPENAI_API_KEY,
  async generate(messages, context) {
    const prompt =
      chatType(context) === "transcript" ? feedbackReplyPrompt : scenarioRoleplayPrompt(context);
    const result = await voiceBackend.generateVNext(
      [
        {
          role: "system",
          content:
            prompt + "\nScenario and UI context: " + JSON.stringify(context),
        },
        ...messages
          .filter((message) => message.content.trim())
          .map(({ role, content }) =>
            role === "user"
              ? { role: "user" as const, content }
              : { role: "assistant" as const, content },
          ),
      ],
      { modelSettings: { maxOutputTokens: 250 } },
    );
    if (!result.text.trim())
      throw new VoiceError(
        "The voice backend returned an empty reply. Please try again.",
      );
    return result.text;
  },
  async save(messages, { threadId, resourceId }) {
    if (!messages.length) return;
    const memory = await defaultAgent.getMemory();
    if (!memory) throw new VoiceError("Conversation memory is unavailable.");
    const thread = await memory.getThreadById({ threadId });
    if (thread && thread.resourceId !== resourceId)
      throw new VoiceError("Conversation belongs to another session.", 403);
    if (!thread)
      await memory.createThread({
        threadId,
        resourceId,
        title: "Voice conversation",
      });
    await memory.saveMessages({
      format: "v2",
      messages: messages.map(({ id, role, content, createdAt, metadata }) => ({
        id,
        role,
        content: {
          format: 2 as const,
          parts: [{ type: "text" as const, text: content }],
          metadata,
        },
        type: "text" as const,
        createdAt: new Date(createdAt),
        threadId,
        resourceId,
      })),
    });
  },
});
