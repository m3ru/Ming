export type TextProvider = "gemini" | "openai";

type ProviderEnvironment = Record<string, string | undefined>;

export type TextProviderConfig = {
  provider: TextProvider;
  model: string;
  apiKey: string | undefined;
};

/** Resolve only the selected vendor. Missing keys never switch providers. */
export function resolveTextProvider(
  env: ProviderEnvironment = process.env,
): TextProviderConfig {
  const provider = env.MING_TEXT_PROVIDER?.trim().toLowerCase() || "gemini";
  if (provider === "gemini") {
    return {
      provider,
      model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      apiKey:
        env.GEMINI_API_KEY?.trim() ||
        env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
        env.GOOGLE_API_KEY?.trim() ||
        undefined,
    };
  }
  if (provider === "openai") {
    return {
      provider,
      model: env.OPENAI_TEXT_MODEL?.trim() || "gpt-6-luna",
      apiKey: env.OPENAI_API_KEY?.trim() || undefined,
    };
  }
  throw new Error('MING_TEXT_PROVIDER must be "gemini" or "openai".');
}

export function isTextConfigured(
  env: ProviderEnvironment = process.env,
): boolean {
  return Boolean(resolveTextProvider(env).apiKey);
}
