"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardContent } from "./ui/card";
import { readCompletedScenarioIds } from "@/lib/completedScenarios";

export default function ProgressCard() {
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(readCompletedScenarioIds(localStorage).length); }, []);
  return (
    <Card className="w-full shadow-lg border border-gray-200">
      <CardHeader><h3 className="text-lg font-bold text-gray-800">Progress Tracker</h3></CardHeader>
      <CardContent>
        <p className="text-sm text-gray-600">{count} {count === 1 ? "scenario" : "scenarios"} completed</p>
        <p className="mt-2 text-sm text-gray-500">Complete a conversation and generate its report to record your practice.</p>
      </CardContent>
    </Card>
  );
}
