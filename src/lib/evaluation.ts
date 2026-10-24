export const evaluationCategories = [
  "Empathy",
  "Clarity",
  "Open-mindedness",
  "Assertiveness",
  "Active Listening",
  "Conflict Management",
] as const;

export type EvaluationCategory = (typeof evaluationCategories)[number];
export type EvaluationCriterion = {
  category: EvaluationCategory;
  score: number | null;
  summary: string;
  noteType: "strength" | "tip";
  note: string;
};

const guidance: Record<
  EvaluationCategory,
  { summary: string; tip: string; keywords: string[] }
> = {
  Empathy: {
    summary: "Recognizing the other person’s feelings and perspective.",
    tip: "Acknowledge how the other person feels before moving to solutions.",
    keywords: ["empath", "feeling", "validat", "acknowledg"],
  },
  Clarity: {
    summary: "Explaining your concerns and expectations clearly.",
    tip: "Use one concrete example and make the next step explicit.",
    keywords: ["clarity", "clear", "specific", "articulat"],
  },
  "Open-mindedness": {
    summary: "Considering other perspectives and possible solutions.",
    tip: "Ask what alternatives the other person would suggest before choosing a plan.",
    keywords: ["open-minded", "open mind", "alternative", "perspective"],
  },
  Assertiveness: {
    summary: "Expressing your needs and boundaries respectfully.",
    tip: "State what needs to change, why it matters, and what you expect next.",
    keywords: ["assertiv", "boundary", "boundaries", "expectation"],
  },
  "Active Listening": {
    summary: "Showing that you heard and understood the other person.",
    tip: "Summarize what you heard and ask whether you understood correctly.",
    keywords: ["listen", "paraphras", "reflect", "follow-up question"],
  },
  "Conflict Management": {
    summary: "Working through tension toward a shared next step.",
    tip: "Name the shared goal and agree on one next step together.",
    keywords: ["conflict", "de-escalat", "tension", "shared goal"],
  },
};

export function normalizeEvaluationCategory(
  value: string,
): EvaluationCategory | undefined {
  const key = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "openmindness" || key === "openmind") return "Open-mindedness";
  return evaluationCategories.find(
    (category) => category.toLowerCase().replace(/[\s_-]+/g, "") === key,
  );
}

function concise(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length > maxWords
    ? words.slice(0, maxWords).join(" ") + "…"
    : text.trim();
}

export function buildEvaluation(
  summaryText: string,
  feedback: string,
  scores: { category: string; score: number }[],
): EvaluationCriterion[] {
  const saved = new Map<
    EvaluationCategory,
    Pick<EvaluationCriterion, "summary" | "noteType" | "note">
  >();
  const section = summaryText.match(
    /##\s*CRITERION FEEDBACK\s*([\s\S]*?)(?=\n##\s|$)/i,
  );
  if (section) {
    try {
      const entries: unknown = JSON.parse(
        section[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, ""),
      );
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!entry || typeof entry !== "object") continue;
          const category =
            typeof entry.category === "string"
              ? normalizeEvaluationCategory(entry.category)
              : undefined;
          if (
            category &&
            typeof entry.summary === "string" &&
            entry.summary.trim() &&
            typeof entry.note === "string" &&
            entry.note.trim() &&
            (entry.noteType === "strength" || entry.noteType === "tip")
          ) {
            saved.set(category, {
              summary: concise(entry.summary, 24),
              noteType: entry.noteType,
              note: concise(entry.note, 22),
            });
          }
        }
      }
    } catch {
      // Older reports have prose feedback only; retain it where relevant.
    }
  }
  const sentences = feedback.replace(/[*_`]/g, "").split(/(?<=[.!?])\s+|\n+/);
  return evaluationCategories.map((category) => {
    const rubric = guidance[category];
    const relevant = sentences.find((sentence) =>
      rubric.keywords.some((keyword) =>
        sentence.toLowerCase().includes(keyword),
      ),
    );
    const score = scores.find(
      (item) => normalizeEvaluationCategory(item.category) === category,
    )?.score;
    return {
      category,
      score:
        score !== undefined && Number.isFinite(score)
          ? Math.max(0, Math.min(100, score))
          : null,
      summary: concise(
        relevant?.replace(/^\s*[-*>#]+\s*/, "").trim() || rubric.summary,
        24,
      ),
      noteType: "tip",
      note: rubric.tip,
      ...saved.get(category),
    };
  });
}
