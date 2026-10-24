import { CircleCheck, Lightbulb } from "lucide-react";
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
        const Icon = strength ? CircleCheck : Lightbulb;
        return (
          <article
            key={criterion.category}
            className="flex min-w-0 flex-col rounded-xl border border-slate-200 p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {criterion.category}
              </h3>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
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
              className="h-2 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${criterion.score ?? 0}%` }}
              />
            </div>
            <p className="mb-4 mt-3 flex-1 text-sm leading-relaxed text-slate-600">
              {criterion.summary}
            </p>
            <div
              className={`flex items-start gap-2 rounded-lg p-3 text-sm leading-relaxed ${strength ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="mb-1 text-xs font-semibold">
                  {strength ? "What went well" : "Try next time"}
                </p>
                <p>{criterion.note}</p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
