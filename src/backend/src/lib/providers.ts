export type TextProvider = "gemini" | "openai";

type ProviderEnvironment = Record<string, string | undefined>;

export type TextProviderConfig = {
  provider: TextProvider;
  model: string;
  apiKey: string | undefined;
};

/** The first nonblank Gemini key; shared by text and speech. */
export function resolveGeminiKey(
  env: ProviderEnvironment = process.env,
): string | undefined {
  return (
    env.GEMINI_API_KEY?.trim() ||
    env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    env.GOOGLE_API_KEY?.trim() ||
    undefined
  );
}

/** Resolve only the selected vendor. Missing keys never switch providers. */
export function resolveTextProvider(
  env: ProviderEnvironment = process.env,
): TextProviderConfig {
  const provider = env.MING_TEXT_PROVIDER?.trim().toLowerCase() || "gemini";
  if (provider === "gemini") {
    return {
      provider,
      model: env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      apiKey: resolveGeminiKey(env),
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

/**
 * Gemini 3 thinks by default, and thinking counts against maxOutputTokens, so a small cap can
 * come back empty. Keep it low. Other models do not take thinkingLevel.
 * shortcut: aliases such as gemini-flash-latest do not match; set GEMINI_MODEL to a versioned gemini-3 name.
 */
export function geminiThinking({ provider, model }: Pick<TextProviderConfig, "provider" | "model">) {
  return provider === "gemini" && /^gemini-3(?:\.\d+)?-/.test(model)
    ? { providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" as const } } } }
    : {};
}

export function isTextConfigured(
  env: ProviderEnvironment = process.env,
): boolean {
  return Boolean(resolveTextProvider(env).apiKey);
}
