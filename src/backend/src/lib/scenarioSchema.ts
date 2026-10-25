import { z } from "zod";

// Shared by the browser and backend. Reject empty/placeholder fields instead of
// letting a partially generated exercise reach the practice conversation.
const text = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine(
    (value) => !/^(unknown|undefined|null|n\/a|todo|\.\.\.)[.!]?$/i.test(value),
    "A complete scenario field is required.",
  );

export const scenarioNpcSchema = z.object({
  name: text(1, 80),
  role: text(4, 240),
  pfp: z.string().trim().min(1).max(2048).refine(
    (value) => /^\/(?!\/)[a-zA-Z0-9/_.-]+$/.test(value) ||
      (value.startsWith("https://") && z.string().url().safeParse(value).success),
    "Use a local asset path or secure portrait URL.",
  ),
  personality: text(10, 3000),
  scenarioSpecificInfo: text(10, 5000),
}).strip();

export const scenarioSchema = z.object({
  title: text(4, 160),
  goal: text(10, 2500),
  goalForAnalyzer: text(10, 3000),
  situation: text(20, 8000),
  situationForAnalyzer: text(20, 8000),
  companyDetails: text(10, 4000),
  userRole: text(4, 2000),
  npcs: z.array(scenarioNpcSchema).min(1).max(4),
  documents: z.array(z.object({
    title: text(4, 160),
    type: text(2, 80),
    content: z.array(z.object({
      format: z.enum(["plain", "bold", "italic", "code"]),
      content: text(1, 3000),
    }).strict()).min(1).max(16),
  }).strict()).min(1).max(8),
}).strict();
