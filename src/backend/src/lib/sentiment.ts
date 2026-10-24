import { z } from "zod";

export const sentimentRequestSchema = z.object({
  text: z.string().trim().min(1).max(12000),
});

export const sentimentSchema = z.object({
  score: z.number().min(-1).max(1),
  magnitude: z.number().min(0).max(1),
});

export type Sentiment = z.infer<typeof sentimentSchema>;
