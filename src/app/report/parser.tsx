"use client";

type Segment = {
  title: string;
  content: string; // Markdown with bolded speaker labels and comment/highlight tags
};

type ParsedResult = {
  summary: string | null;
  feedback: string | null;
  suggestions: string | null;
  segments: Segment[];
  scores: { category: string; score: number }[];
};

const defaultScores: ParsedResult["scores"] = [
  { category: "Empathy", score: 85 },
  { category: "Clarity", score: 90 },
  { category: "Open-mindedness", score: 80 },
  { category: "Assertiveness", score: 75 },
  { category: "Active Listening", score: 88 },
  { category: "Conflict Management", score: 99 },
];

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

  // --- Summary ---
  const summaryMatch = summaryText.match(
    /##\s*CONVERSATION OVERVIEW\s*([\s\S]*?)(?=##|$)/i
  );
  if (summaryMatch) result.summary = summaryMatch[1].trim();

  // --- Feedback ---
  const feedbackMatch = summaryText.match(
    /##\s*USER PERFORMANCE ANALYSIS\s*([\s\S]*?)(?=(?:##|$))/i
  );
  result.feedback = feedbackMatch ? feedbackMatch[1].trim() : null;

  // --- Suggestions ---
  const suggestionsMatch = summaryText.match(
    /##\s*IMPROVEMENT RECOMMENDATIONS\s*([\s\S]*?)(?=##|$)/i
  );
  result.suggestions = suggestionsMatch ? suggestionsMatch[1].trim() : null;

  // --- Scores ---
  const ratingMatch = summaryText.match(/##\s*RATING\s*([\s\S]*?)(?=##|$)/i);
  if (ratingMatch) {
    const lines = ratingMatch[1]
      .split("\n")
      .map((l: string) => l.replace(/^\*+/g, "").trim())
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

    const defaultMap = new Map<string, number>();
    result.scores.forEach((s, i) => defaultMap.set(s.category, i));

    for (const ps of parsedScores) {
      const idx = defaultMap.get(ps.category);
      if (idx !== undefined) {
        result.scores[idx] = { category: ps.category, score: ps.score };
      } else {
        result.scores.push(ps);
      }
    }
  }

  // --- Segments ---
  const segRegex = /<segment:\s*([^>]+)>([\s\S]*?)<\/segment:\s*\1>/gi;
  let segMatch;
  while ((segMatch = segRegex.exec(detailText)) !== null) {
    const title = segMatch[1].trim();
    let content = segMatch[2].trim();

    // --- Keep <comment> and <highlight> tags intact ---
    // Bold speaker labels (first letter capitalized)
    content = content.replace(
      /^(\s*)(\w+):/gim,
      (_, ws, speaker) =>
        `${ws}**${speaker.charAt(0).toUpperCase()}${speaker.slice(1)}:**`
    );

    result.segments.push({ title, content });
  }

  return result;
}