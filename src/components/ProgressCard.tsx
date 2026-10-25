"use client";

import { useEffect, useState } from "react";
import { readCompletedScenarioIds } from "@/lib/completedScenarios";

export default function ProgressCard() {
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(readCompletedScenarioIds(localStorage).length); }, []);
  return (
    <div className="rounded-xl border border-rule bg-white px-5 py-4">
      <p className="text-sm font-semibold text-ink">
        {count} {count === 1 ? "session" : "sessions"} completed
      </p>
      {count === 0 && (
        <p className="mt-1 text-sm text-ink-soft">
          Complete a conversation and generate its report to record your practice.
        </p>
      )}
    </div>
  );
}
