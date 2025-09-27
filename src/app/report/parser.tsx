"use client";

type ParsedResult = {
  summary: string | null;
  feedback: string | null;
  suggestions: string | null;
  segments: { title: string; content: string }[];
  scores: { category: string; score: number }[];
};

export default function Parser(rawText: string): ParsedResult {
  const result: ParsedResult = {
    summary: null,
    feedback: null,
    suggestions: null,
    segments: [],
    scores: [],
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

  // --- Summary (Conversation Overview) ---
  const summaryMatch = summaryText.match(
    /##\s*CONVERSATION OVERVIEW\s*([\s\S]*?)(?=##|$)/i
  );
  if (summaryMatch) {
    result.summary = summaryMatch[1].trim();
  }

  // --- Feedback (Performance Analysis + Recommendations, without Ratings) ---
  let perfMatch = summaryText.match(
    /##\s*USER PERFORMANCE ANALYSIS\s*([\s\S]*?)(?=##|$)/i
  );
  const improvementMatch = summaryText.match(
    /##\s*IMPROVEMENT RECOMMENDATIONS\s*([\s\S]*?)(?=##|$)/i
  );

  // Remove **RATING** block from performance analysis text
  if (perfMatch) {
    perfMatch[1] = perfMatch[1].replace(/\*\*RATING\*\*[\s\S]*/i, "").trim();
  }

  // Assign feedback (performance analysis) and suggestions (improvement recommendations)
  result.feedback = perfMatch ? perfMatch[1].trim() : null;
  result.suggestions = improvementMatch ? improvementMatch[1].trim() : null;

  // --- Scores (from RATING block) ---
  const ratingBlock = summaryText.match(/\*\*RATING\*\*([\s\S]*?)(?=##|$)/i);
  if (ratingBlock) {
    const lines = ratingBlock[1].split("\n").map((l: string) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/-\s*([^:]+):\s*(\d+)/);
      if (m) {
        result.scores.push({
          category: m[1].trim(),
          score: Number(m[2]),
        });
      }
    }
  }

  // --- Segments ---
  const segRegex = /<segment:\s*([^>]+)>([\s\S]*?)<\/segment:\s*\1>/gi;
  let segMatch;
  while ((segMatch = segRegex.exec(detailText)) !== null) {
    result.segments.push({
      title: segMatch[1].trim(),
      content: segMatch[2].trim(),
    });
  }

  console.log("Parsed Result:", result);
  return result;
}