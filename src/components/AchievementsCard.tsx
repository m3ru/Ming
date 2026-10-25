"use client";

import { useEffect, useState } from "react";
import { readCompletedScenarioIds } from "@/lib/completedScenarios";
import { Trophy, Star } from "lucide-react";

export default function AchievementsCard() {
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(readCompletedScenarioIds(localStorage).length); }, []);
  const achievements = [
    { title: "First scenario complete", icon: Trophy, unlocked: count >= 1 },
    { title: "Three practice sessions", icon: Star, unlocked: count >= 3 },
    { title: "Five practice sessions", icon: Star, unlocked: count >= 5 },
  ];
  return (
    <section aria-labelledby="achievements" className="rounded-xl border border-rule bg-white p-5 sm:p-6">
      <h2 id="achievements" className="text-2xl font-extrabold tracking-tight text-ink">
        Achievements
      </h2>
      <ul className="mt-4 space-y-2">
        {achievements.map((ach) => (
          <li
            key={ach.title}
            className="flex items-center gap-3 rounded-lg border border-rule px-3 py-2.5"
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-300 ${
                ach.unlocked ? "bg-sage/15 text-sage" : "bg-muted text-ink-soft"
              }`}
            >
              <ach.icon aria-hidden className="size-5" />
            </span>
            <span
              className={`min-w-0 flex-1 text-sm ${
                ach.unlocked ? "font-semibold text-ink" : "text-ink-soft"
              }`}
            >
              {ach.title}
            </span>
            <span className={`text-sm ${ach.unlocked ? "font-semibold text-ink" : "text-ink-soft"}`}>
              {ach.unlocked ? "Unlocked" : "Locked"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
