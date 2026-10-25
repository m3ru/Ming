import { sentimentSchema } from "@/backend/src/lib/sentiment";
export type { Sentiment } from "@/backend/src/lib/sentiment";

export async function analyzeSentiment(text: string, signal?: AbortSignal) {
  const baseURL = "/api/backend";
  const response = await fetch(baseURL.replace(/\/$/, "") + "/sentiment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(25000),
    ]),
  });
  if (!response.ok) throw new Error("Sentiment scoring is unavailable.");
  return sentimentSchema.parse(await response.json());
}
