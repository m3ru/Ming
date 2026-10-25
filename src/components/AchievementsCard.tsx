"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { readCompletedScenarioIds } from "@/lib/completedScenarios";
import { Trophy, Star } from "lucide-react";

export default function AchievementsCard() {
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(readCompletedScenarioIds(localStorage).length); }, []);
  const achievements = [
    { title: "First Scenario Complete", icon: Trophy, unlocked: count >= 1 },
    { title: "Three Practice Sessions", icon: Star, unlocked: count >= 3 },
    { title: "Five Practice Sessions", icon: Star, unlocked: count >= 5 },
  ];
  return (
    <Card className="w-full shadow-lg border border-gray-200">
      <CardHeader>
        <h3 className="text-lg font-bold text-gray-800">Achievements</h3>
      </CardHeader>
      <CardContent className="flex gap-4">
        {achievements.map((ach, idx) => (
          <div
            key={idx}
            className={`flex flex-col items-center justify-center p-2 md:p-4 rounded-lg w-32 h-32 ${
              ach.unlocked ? "bg-blue-100" : "bg-gray-100 opacity-50"
            }`}
          >
            <ach.icon
              className={`h-8 w-8 mb-2 ${
                ach.unlocked ? "text-blue-600" : "text-gray-400"
              }`}
            />
            <span
              className={`text-center text-sm ${
                ach.unlocked ? "font-semibold text-gray-800" : "text-gray-400"
              }`}
            >
              {ach.title}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
