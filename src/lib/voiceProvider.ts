export type VoiceProvider = "openai" | "deepgram";

/** Only a provider name crosses the server/client boundary; never API keys. */
export function resolveVoiceProvider(value?: string): VoiceProvider {
  const provider = value?.trim().toLowerCase() || "openai";
  if (provider !== "openai" && provider !== "deepgram") {
    throw new Error("MING_VOICE_PROVIDER must be openai or deepgram.");
  }
  return provider;
}
