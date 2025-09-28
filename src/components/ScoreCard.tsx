"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import ScoreBar from "./ScoreBar";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import React from "react";

export default function ScoreCard() {
  const defaultScores = [
    { category: "Empathy", score: 0 },
    { category: "Clarity", score: 0 },
    { category: "Open-mindedness", score: 0 },
    { category: "Assertiveness", score: 0 },
    { category: "Active Listening", score: 0 },
    { category: "Conflict Management", score: 0 },
  ];
  const router = useRouter();
  const [prevScores, setPrevScores] = React.useState(defaultScores);
  const [scores, setScores] = React.useState(defaultScores);

  React.useEffect(() => {
    const prevScoresString = localStorage.getItem("prevScores");
    if (!prevScoresString) {
      localStorage.setItem("prevScores", JSON.stringify(defaultScores));
      setPrevScores(defaultScores);
    } else {
      setPrevScores(JSON.parse(prevScoresString));
    }

    const scoresString = localStorage.getItem("scores");
    if (!scoresString) {
      localStorage.setItem("scores", JSON.stringify(defaultScores));
      setScores(defaultScores);
    } else {
      setScores(JSON.parse(scoresString));
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
