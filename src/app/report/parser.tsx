import {
  buildEvaluation,
  evaluationCategories,
  normalizeEvaluationCategory,
  type EvaluationCategory,
  type EvaluationCriterion,
} from "@/lib/evaluation";
import { parseAnnotationSegments, type AnnotationSegment } from "@/lib/reportAnnotations";

export type ReportScore = {
  category: EvaluationCategory;
  score: number | null;
};
export type ReportSegment = { title: string; content: string; highlights?: AnnotationSegment["highlights"] };

export type ParsedResult = {
  status: "ready" | "partial" | "invalid";
  issues: string[];
  summary: string | null;
  feedback: string | null;
  suggestions: string | null;
  segments: ReportSegment[];
  scores: ReportScore[];
  evaluation: EvaluationCriterion[];
  sessionId: string | null;
  transcript: string | null;
  createdAt: string | null;
  annotationStatus?: "pending" | "ready";
};

export function emptyReportScores(): ReportScore[] {
  return evaluationCategories.map((category) => ({ category, score: null }));
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default function Parser(rawText: string): ParsedResult {
  const result: ParsedResult = {
    status: "invalid",
    issues: [],
    summary: null,
    feedback: null,
    suggestions: null,
    segments: [],
    scores: emptyReportScores(),
    evaluation: buildEvaluation("", "", []),
    sessionId: null,
    transcript: null,
    createdAt: null,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    result.issues.push("The saved report is not valid JSON.");
    return result;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    result.issues.push("The saved report does not contain a report object.");
    return result;
  }

  const record = parsed as Record<string, unknown>;
  const summaryText = nonemptyString(record.summary) || "";
  const detailText = nonemptyString(record.detail) || "";
  result.sessionId = nonemptyString(record.sessionId);
  result.transcript = nonemptyString(record.transcript);
  result.createdAt = nonemptyString(record.createdAt);
  result.annotationStatus = record.annotationStatus === "pending" ? "pending" : undefined;

  const section = (heading: string): string | null => {
    const match = summaryText.match(
      new RegExp(
        `^##[ \\t]+${heading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^##[ \\t]|(?![\\s\\S]))`,
        "im",
      ),
    );
    return match ? nonemptyString(match[1]) : null;
  };

  result.summary = section("CONVERSATION OVERVIEW");
  result.feedback = section("USER PERFORMANCE ANALYSIS");
  result.suggestions = section("IMPROVEMENT RECOMMENDATIONS");

  const ratings = new Map<EvaluationCategory, number | null>();
  for (const line of (section("RATING") || "").split("\n")) {
    // Accept the specified rating format, including optional Markdown emphasis.
    // Reject negative/out-of-range values rather than turning them into a score.
    const match = line
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/\*\*/g, "")
      .match(/^([^:]+):\s*(\d+(?:\.\d+)?)\s*(?:\/\s*100|%)?\s*$/);
    if (!match) continue;
    const category = normalizeEvaluationCategory(match[1].trim());
    const score = Number(match[2]);
    if (!category || !Number.isFinite(score) || score < 0 || score > 100)
      continue;
    // Conflicting duplicate ratings are ambiguous, so keep that skill unknown.
    ratings.set(
      category,
      ratings.has(category) && ratings.get(category) !== score ? null : score,
    );
  }
  result.scores = result.scores.map(({ category }) => ({
    category,
    score: ratings.get(category) ?? null,
  }));
  result.evaluation = buildEvaluation(
    summaryText,
    result.feedback || "",
    result.scores.flatMap(({ category, score }) =>
      score === null ? [] : [{ category, score }],
    ),
  );

  const segRegex = /<segment:\s*([^>]+)>([\s\S]*?)<\/segment:\s*\1>/gi;
  let segMatch: RegExpExecArray | null;
  while ((segMatch = segRegex.exec(detailText)) !== null) {
    const title = segMatch[1].trim();
    const content = segMatch[2]
      .trim()
      .replace(
        /^(\s*)(\w+):/gim,
        (_, whitespace: string, speaker: string) =>
          `${whitespace}**${speaker.charAt(0).toUpperCase()}${speaker.slice(1)}:**`,
      );
    if (title && content) result.segments.push({ title, content });
  }
  if (record.annotationSegments !== undefined) {
    const structured = parseAnnotationSegments(record.annotationSegments, result.transcript);
    if (structured) {
      result.segments = structured;
      if (record.annotationStatus === "ready") result.annotationStatus = "ready";
    } else {
      result.segments = [];
      result.issues.push("The transcript notes contain invalid locations.");
    }
  }

  const hasContent =
    result.summary ||
    result.feedback ||
    result.suggestions ||
    result.segments.length ||
    result.scores.some(({ score }) => score !== null);
  if (!hasContent) {
    result.issues.push(
      "No readable summary, evaluation, or annotated transcript was found in the saved report.",
    );
    return result;
  }
  if (!result.summary)
    result.issues.push("The conversation summary is unavailable.");
  if (!result.feedback)
    result.issues.push("Performance feedback is unavailable.");
  if (!result.suggestions)
    result.issues.push("Improvement recommendations are unavailable.");
  if (!result.segments.length)
    result.issues.push("The annotated transcript is unavailable.");
  if (result.scores.some(({ score }) => score === null)) {
    result.issues.push(
      "Some skills were not scored. Missing ratings remain unknown.",
    );
  }
  result.status = result.issues.length ? "partial" : "ready";
  return result;
}
