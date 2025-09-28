"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import ScenarioCard from "@/components/ScenarioCard";
import MenuBar from "@/components/MenuBar";
import ScoreCard from "@/components/ScoreCard";
import AchievementsCard from "@/components/AchievementsCard";
import ProgressCard from "@/components/ProgressCard";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

type analyticsData = {
  numScenariosCompleted?: number;
  latestScores?: { category: string; score: number }[];
  prevScores?: { category: string; score: number }[];
};

const defaultScores = [
  { category: "Empathy", score: 0 },
  { category: "Clarity", score: 0 },
  { category: "Open-mindedness", score: 0 },
  { category: "Assertiveness", score: 0 },
  { category: "Active Listening", score: 0 },
  { category: "Conflict Management", score: 0 },
];

export default function HomePage() {
  const router = useRouter();

  const [mainText, setMainText] = React.useState("Budding Manager");
  const [scores, setScores] = React.useState(defaultScores);
  const [prevScores, setPrevScores] = React.useState(defaultScores);

  const [showAnalytics, setShowAnalytics] = React.useState(false);
  const analyticsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const stored = localStorage.getItem("reportData");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.scores) setScores(data.scores);
      } catch (error) {
        console.log("Could not parse report data:", error);
      }
    }
  }, []);

  React.useEffect(() => {
   

    const prevScoresString = localStorage.getItem('prevScores');
    if (!prevScoresString){
      localStorage.setItem('prevScores', JSON.stringify(defaultScores));
      setPrevScores(defaultScores);
    }
    else {
      setPrevScores(JSON.parse(prevScoresString));
    }

    const scoresString = localStorage.getItem('scores');
    if (!scoresString){
      localStorage.setItem('scores', JSON.stringify(defaultScores));
      setScores(defaultScores);
    }
    else {
      setScores(JSON.parse(scoresString));
    }
  }, []);

  React.useEffect(() => {
    const analytics = localStorage.getItem("analytics");
    if (analytics) {
      try {
        const data: analyticsData = JSON.parse(analytics);
        setScenariosCompleted(data.numScenariosCompleted || 0);
        setScores(data.latestScores || defaultScores);
      } catch (error) {
        console.log("Could not parse analytics data:", error);
      }
    } else {
      const data: analyticsData = {};
      data.numScenariosCompleted = 0;
      data.latestScores = defaultScores;
      data.prevScores = defaultScores;
      localStorage.setItem("analytics", JSON.stringify(data));
    }
  }, []);

  React.useEffect(() => {
    if (showAnalytics) {
      // Use a setTimeout to allow the CSS transition to begin before scrolling
      const timer = setTimeout(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth",
        });
      }, 300); // A small delay, adjust as needed

      return () => clearTimeout(timer);
    }
  }, [showAnalytics]);

  const toggleAnalytics = () => {
    setShowAnalytics((prev) => !prev);
  };

  useEffect(() => {
    window.addEventListener("wheel", (e: WheelEvent) => {
      if (analyticsRef.current) {
        const delta = e.deltaY;

        if (delta > 0) {
          // Scrolling down
          setShowAnalytics(true);
        } else if (delta < 0) {
          // Scrolling up
          setShowAnalytics(false);
        }
      }
    });
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-y-auto grid-background">
      <MenuBar />
      {/* Main Section */}
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">
            Welcome back,
          </h1>
          <h1 className="text-6xl font-bold text-blue-800 mb-4">{mainText}</h1>
          <p className="text-lg text-gray-600 mb-8">
            Pass the first task to unlock new scenarios!
          </p>
        </div>
        {/* Scenario Cards */}
        <div className="flex flex-wrap justify-center gap-4 w-full max-w-6xl">
          <ScenarioCard
            title="Performance Problems"
            imageUrl="/performanceReview.webp"
            description="An employee performance review meeting."
            color="#ffffff97"
            locked={false}
            role="Level: Intern"
          />
          <ScenarioCard
            title="Workplace Conflict"
            imageUrl="/workplaceConflict.jpg"
            description="A tense discussion between coworkers."
            color="#1f1c1897"
            locked={true}
            role="Level: Manager"
          />
          <ScenarioCard
            title="Employee Layoff"
            imageUrl="/employeeLayoff.jpg"
            description="A manager informing an employee about layoffs."
            color="#1f1c1897"
            locked={true}
            role="Level: CEO"
          />
        </div>
        {/* Analytics Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleAnalytics}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-xl mt-20"
        >
          {showAnalytics
            ? "Scroll Up for Scenarios"
            : "Scroll Down for Analytics"}
          {showAnalytics ? (
            <ChevronUp className="h-10 w-10 animate-bounce" />
          ) : (
            <ChevronDown className="mt-2 h-10 w-10 animate-bounce" />
          )}
        </Button>
        {/* Analytics Section */}
        <div
          ref={analyticsRef}
          className={`
            w-full bg-gray-50 overflow-hidden transition-all duration-500 ease-in-out
            ${showAnalytics ? "opacity-100 max-h-[2000px] py-6" : "opacity-0 max-h-0 py-0 pointer-events-none"}
          `}
        >
          <div className="flex flex-col max-w-5xl mx-auto px-4 space-y-5">
            <ScoreCard scores={scores} />
            <AchievementsCard />
            <ProgressCard completedScenarios={scenariosCompleted} />
          </div>
        </div>
      </div>
    </div>
  );
}
