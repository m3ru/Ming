"use client";

import ScoreBar from "./ScoreBar";
import Link from "next/link";
import React from "react";
import Parser, { emptyReportScores } from "@/app/report/parser";

export default function ScoreCard() {
  const [scores, setScores] = React.useState(emptyReportScores);

  React.useEffect(() => {
    try {
      // Re-derive from the report so older fabricated score caches cannot appear
      // as current performance. Merely viewing a report never changes history.
      const stored = localStorage.getItem("reportData");
      if (!stored) return;
      const report = Parser(stored);
      if (report.status !== "invalid") setScores(report.scores);
    } catch {
      setScores(emptyReportScores());
    }
  }, []);

  return (
    <section aria-labelledby="latest-scores" className="rounded-xl border border-rule bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 id="latest-scores" className="text-2xl font-extrabold tracking-tight text-ink">
            Latest scores
          </h2>
          <p className="mt-1 text-ink-soft">From your most recent report</p>
        </div>
        <Link href="/report" className="text-sm font-semibold text-pencil underline-offset-4 hover:underline">
          View full report
        </Link>
      </div>
      {scores.every(({ score }) => score === null) ? (
        <p className="mt-4 text-sm text-ink-soft">
          Finish a conversation to see your scores here.
        </p>
      ) : null}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scores.map(({ category, score }) => (
          <ScoreBar key={category} category={category} score={score} />
        ))}
      </div>
    </section>
  );
}
