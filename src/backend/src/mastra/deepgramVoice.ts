import { Agent } from "@mastra/core/agent";
import { createDeepgramVoiceService } from "../lib/deepgramVoice";
import { scenarioRoleplayPrompt, feedbackReplyPrompt, spokenDelivery } from "../lib/prompts";
import { geminiThinking, resolveGeminiKey, resolveTextProvider } from "../lib/providers";
import { reserveGeneration } from "../lib/security";
import { chatType } from "../lib/voice";
import { defaultAgent } from "./agents/defaultAgent";
import { isTextConfigured, textModel } from "./models";

const voiceResponder = new Agent({
  name: "deepgram-voice-responder",
  model: textModel,
  instructions: "Respond naturally to the supplied conversation. Speak English, keep replies under 100 words, and do not use markdown.",
});

export const deepgramVoice = createDeepgramVoiceService({
  apiKey: () => process.env.DEEPGRAM_API_KEY,
  sttModel: () => process.env.DEEPGRAM_STT_MODEL,
  ttsModel: () => process.env.DEEPGRAM_TTS_MODEL,
  ttsProvider: () => process.env.MING_TTS_PROVIDER,
  geminiApiKey: () => resolveGeminiKey(),
  geminiTtsModel: () => process.env.GEMINI_TTS_MODEL,
  geminiTtsVoice: () => process.env.GEMINI_TTS_VOICE,
  reserve: (identity) => reserveGeneration(identity, 3),
  async generate(messages, context, signal) {
    if (!isTextConfigured()) throw new Error("Text AI is not configured.");
    const { provider, model } = resolveTextProvider();
    const prompt = chatType(context) === "transcript" ? feedbackReplyPrompt : scenarioRoleplayPrompt(context) + spokenDelivery;
    const result = await voiceResponder.generateVNext([
      { role: "system", content: prompt + "\nScenario and UI context: " + JSON.stringify(context) },
      ...messages.filter((m) => m.content.trim()).map(({ role, content }) =>
        role === "user" ? { role: "user" as const, content } : { role: "assistant" as const, content }),
    ], {
      abortSignal: signal,
      // Output caps include reasoning (Gemini thinking; GPT-6 Luna at medium effort); leave room for the answer.
      modelSettings: { maxOutputTokens: provider === "gemini" ? 1024 : 2048 },
      ...geminiThinking({ provider, model }),
    });
    return result.text;
  },
  async save(messages, { threadId, resourceId }) {
    const memory = await defaultAgent.getMemory();
    if (!memory) throw new Error("Conversation storage is unavailable.");
    const thread = await memory.getThreadById({ threadId });
    if (!thread || thread.resourceId !== resourceId) throw new Error("Conversation is unavailable.");
    await memory.saveMessages({ format: "v2", messages: messages.map(({ id, role, content, createdAt, metadata }) => ({
      id, role, type: "text" as const, threadId, resourceId, createdAt: new Date(createdAt),
      content: { format: 2 as const, parts: [{ type: "text" as const, text: content }], metadata },
    })) });
  },
});
