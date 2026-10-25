"use client";

import {
  Ear,
  Gauge,
  Handshake,
  Heart,
  Lightbulb,
  Megaphone,
  Target,
  type LucideIcon,
} from "lucide-react";

const icons = new Map<string, LucideIcon>([
  ["Empathy", Heart],
  ["Clarity", Target],
  ["Open-mindedness", Lightbulb],
  ["Assertiveness", Megaphone],
  ["Active Listening", Ear],
  ["Conflict Management", Handshake],
]);

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
  const Icon = icons.get(category) ?? Gauge;
  return (
    <div className="flex flex-col rounded-xl border border-rule bg-white p-4">
      <div className="flex flex-1 items-start gap-2 text-sm font-medium leading-snug text-ink">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-soft" />
        <span>{category}</span>
      </div>
      <span
        className={`mt-2 block tabular-nums ${
          value === null
            ? "text-base font-semibold text-ink-soft"
            : "text-[26px] font-bold leading-tight text-ink"
        }`}
      >
        {value === null ? "Not scored" : `${value}/100`}
      </span>
      <div
        role="progressbar"
        aria-label={category}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? "Not scored" : `${value} out of 100`}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-sage"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}
