"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import ScoreBar from "./ScoreBar";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import React from "react";
import Parser, { emptyReportScores } from "@/app/report/parser";

export default function ScoreCard() {
  const router = useRouter();
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
    <Card className="shadow-lg border border-gray-200">
      <CardHeader className="flex flex-row items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">Latest Scores</h3>
        <Button
          onClick={() => router.push("/report")}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
        >
          View Full Report
        </Button>
      </CardHeader>
      <CardContent>
        {scores.every(({ score }) => score === null) ? (
          <p className="mb-2 text-sm text-gray-600">
            No scored report is available yet.
          </p>
        ) : null}
        <div className="md:grid md:grid-cols-2 max-md:flex max-md:flex-col md:gap-4">
          <div className="flex-1">
            <ScoreBar category={scores[0].category} score={scores[0].score} />
            <ScoreBar category={scores[2].category} score={scores[2].score} />
            <ScoreBar category={scores[4].category} score={scores[4].score} />
          </div>
          <div className="flex-1">
            <ScoreBar category={scores[1].category} score={scores[1].score} />
            <ScoreBar category={scores[3].category} score={scores[3].score} />
            <ScoreBar category={scores[5].category} score={scores[5].score} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
