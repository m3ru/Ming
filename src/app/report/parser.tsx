"use client";

type ParsedResult = {
  summary: string | null;
  feedback: string | null;
  suggestions: string | null;
  segments: { title: string; content: string }[];
  scores: { category: string; score: number }[];
};

const defaultScores: ParsedResult["scores"] = [
  { category: "Empathy", score: 0 },
  { category: "Clarity", score: 0 },
  { category: "Open-mindedness", score: 0 },
  { category: "Assertiveness", score: 0 },
  { category: "Active Listening", score: 0 },
  { category: "Conflict Management", score: 0 },
];

// Mapping of possible AI variants to canonical categories
const CATEGORY_ALIASES: Record<string, string> = {
  empathy: "Empathy",
  clarity: "Clarity",
  "openmindness": "Open-mindedness",
  "openmindedness": "Open-mindedness",
  "open mindness": "Open-mindedness",
  "open mind": "Open-mindedness",
  assertiveness: "Assertiveness",
  activelistening: "Active Listening",
  "active listening": "Active Listening",
  conflictmanagement: "Conflict Management",
  "conflict management": "Conflict Management",
};

export default function Parser(rawText: string): ParsedResult {
  const result: ParsedResult = {
    summary: null,
    feedback: null,
    suggestions: null,
    segments: [],
    scores: defaultScores.map((s) => ({ ...s })),
  };

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    console.error("Invalid JSON string:", e);
    return result;
  }

  const summaryText = parsed.summary || "";
  const detailText = parsed.detail || "";

  // --- Conversation Overview ---
  const summaryMatch = summaryText.match(
    /##\s*CONVERSATION OVERVIEW\s*([\s\S]*?)(?=##|$)/i
  );
  if (summaryMatch) result.summary = summaryMatch[1].trim();

  // --- Feedback ---
  let perfMatch = summaryText.match(
    /##\s*USER PERFORMANCE ANALYSIS\s*([\s\S]*?)(?=(?:\*\*RATING\*\*|##|$))/i
  );
  if (perfMatch) perfMatch[1] = perfMatch[1].trim();
  result.feedback = perfMatch ? perfMatch[1].trim() : null;

  // --- Suggestions ---
  const improvementMatch = summaryText.match(
    /##\s*IMPROVEMENT RECOMMENDATIONS\s*([\s\S]*?)(?=##|$)/i
  );
  result.suggestions = improvementMatch ? improvementMatch[1].trim() : null;

  // --- Scores ---
  const ratingBlock = summaryText.match(/\*\*RATING\*\*([\s\S]*?)(?=##|$)/i);
  if (ratingBlock) {
    const lines = ratingBlock[1]
      .split("\n")
      .map((l: string) => l.replace(/^\*+/g, "").trim()) // Remove leading asterisks
      .filter(Boolean);

    const parsedScores: { category: string; score: number }[] = [];

    for (const line of lines) {
      const m = line.match(/-?\s*([^:]+):\s*(\d+)/i);
      if (m) {
        const rawCat = m[1].trim().toLowerCase().replace(/[\s\-_]+/g, "");
        const canonicalCat = CATEGORY_ALIASES[rawCat] || m[1].trim();
        parsedScores.push({ category: canonicalCat, score: Number(m[2]) });
      }
    }

    // Merge parsed scores with default scores
    const defaultMap = new Map<string, number>();
    result.scores.forEach((s, i) => defaultMap.set(s.category, i));

    for (const ps of parsedScores) {
      const idx = defaultMap.get(ps.category);
      if (idx !== undefined) {
        result.scores[idx] = { category: ps.category, score: ps.score };
      } else {
        // Append any unknown/new categories
        result.scores.push(ps);
      }
    }
  }

  // --- Segments ---
  const segRegex = /<segment:\s*([^>]+)>([\s\S]*?)<\/segment:\s*\1>/gi;
  let segMatch;
  while ((segMatch = segRegex.exec(detailText)) !== null) {
    let content = segMatch[2].trim();

    // Make speaker labels bold in Markdown with first letter capitalized
    content = content.replace(
      /^(\s*)(\w+):/gim,
      (_, ws, speaker) =>
        `${ws}**${speaker.charAt(0).toUpperCase()}${speaker.slice(1)}:**`
    );

    result.segments.push({
      title: segMatch[1].trim(),
      content,
    });
  }

  return result;
}