import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { resolveTextProvider } from "../lib/providers";

export { isTextConfigured } from "../lib/providers";

// Backend scripts load the root .env. Constructing a model does not contact the
// provider, so the app can boot before optional credentials are configured.
const config = resolveTextProvider();
export const textModel =
  config.provider === "gemini"
    ? createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model)
    : createOpenAI({ apiKey: config.apiKey }).chat(config.model);
