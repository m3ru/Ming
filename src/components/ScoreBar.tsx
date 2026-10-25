"use client";

export default function ScoreBar({
  category,
  score,
}: {
  category: string;
  score: number | null;
}) {
  const value =
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100
      ? score
      : null;
  return (
    <div>
      <div className="mx-2 mt-2 mb-3">
        <div className="flex justify-between mb-1 max-md:text-sm">
          <span className="font-medium">{category}</span>
          <span className="tabular-nums">
            {value === null ? "Not scored" : `${value}/100`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={category}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value ?? undefined}
          aria-valuetext={value === null ? "Not scored" : `${value} out of 100`}
          className="max-md:hidden w-full h-3 bg-gray-200 rounded"
        >
          <div
            className="md:h-3 bg-blue-500 rounded"
            style={{ width: `${value ?? 0}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
}
