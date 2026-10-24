import { openai } from "@ai-sdk/openai";

// Uses OPENAI_API_KEY from the root .env loaded by the backend scripts.
export const textModel = openai.chat("gpt-5.4-mini");
