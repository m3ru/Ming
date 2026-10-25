import type { EvaluationCriterion } from "@/lib/evaluation";

export default function EvaluationGrid({
  criteria,
}: {
  criteria: EvaluationCriterion[];
}) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      aria-label="Evaluation criteria"
    >
      {criteria.map((criterion) => {
        const strength = criterion.noteType === "strength";
        return (
          <article
            key={criterion.category}
            className="flex min-w-0 flex-col rounded-xl border border-rule bg-white p-4"
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="font-semibold">{criterion.category}</h3>
              <span className="shrink-0 text-sm tabular-nums text-ink-soft">
                {criterion.score === null
                  ? "Not scored"
                  : `${criterion.score}/100`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={criterion.category}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={criterion.score ?? undefined}
              aria-valuetext={
                criterion.score === null
                  ? "Not scored"
                  : `${criterion.score} out of 100`
              }
              className="h-1.5 overflow-hidden rounded-full bg-paper"
            >
              <div
                className="h-full rounded-full bg-sage"
                style={{ width: `${criterion.score ?? 0}%` }}
              />
            </div>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-soft">
              {criterion.summary}
            </p>
            <div className="mt-4 border-t border-dashed border-rule pt-3">
              <p
                className={`text-sm font-semibold ${strength ? "text-sage" : "text-red-pencil"}`}
              >
                {strength ? "What went well" : "Try next time"}
              </p>
              <p className="hand mt-1 text-[26px] text-pencil">
                {criterion.note}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
