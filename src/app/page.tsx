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
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

type analyticsData = {
  numScenariosCompleted?: number;
  latestScores?: { category: string; score: number }[];
  prevScores?: { category: string; score: number }[];
};

export default function HomePage() {
  const router = useRouter();

  const [mainText, setMainText] = React.useState("Budding Manager");

  const [showAnalytics, setShowAnalytics] = React.useState(false);
  const analyticsRef = React.useRef<HTMLDivElement>(null);

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

  const scenarioCards = [
    <ScenarioCard
      key="negative-review"
      title="Negative Performance Review"
      imageUrl="/performanceReview.webp"
      description="An employee performance review meeting."
      color="#ffffff97"
      locked={false}
      role="Level: Intern"
    />,
    <ScenarioCard
      key="workplace-conflict"
      title="Workplace Conflict"
      imageUrl="/workplaceConflict.jpg"
      description="A tense discussion between coworkers."
      color="#1f1c1897"
      locked={true}
      role="Level: Manager"
    />,
    <ScenarioCard
      key="employee-layoff"
      title="Employee Layoff"
      imageUrl="/employeeLayoff.jpg"
      description="A manager informing an employee about layoffs."
      color="#1f1c1897"
      locked={true}
      role="Level: CEO"
    />,
  ];

  return (
    <div className="relative min-h-screen w-full overflow-y-auto grid-background overflow-x-clip">
      {/* Main Section */}
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-5 md:p-8 space-y-2 md:space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">
            Welcome back,
          </h1>
          <h1 className="text-6xl font-bold text-blue-800 mb-4">{mainText}</h1>
          <p className="text-lg text-gray-600 md:mb-8">
            <span className="max-md:hidden">
              Keep working hard to unlock new scenarios!
            </span>
            <span className="md:hidden">Try this scenario to get started!</span>
          </p>
        </div>
        {/* Scenario Cards */}
        <div className="max-md:hidden flex flex-wrap justify-center gap-4 w-full max-w-6xl">
          {scenarioCards}
        </div>
        <div className="md:hidden w-full max-w-3xl">{scenarioCards[0]}</div>
        {/* Analytics Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleAnalytics}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-xl mt-7 md:mt-20"
        >
          <span className="max-md:hidden">
            {showAnalytics
              ? "Scroll Up for Scenarios"
              : "Scroll Down for Analytics"}
          </span>
          <span className="md:hidden">
            {showAnalytics ? "Tap for Scenarios" : "Tap for Analytics"}
          </span>
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
            w-full bg-gray-50 overflow-hidden transition-all duration-500 ease-in-out rounded-lg
            ${showAnalytics ? "opacity-100 max-h-[2000px] py-4 md:py-6" : "opacity-0 max-h-0 py-0 pointer-events-none"}
          `}
        >
          <div className="flex flex-col max-w-5xl mx-auto px-4 space-y-3 md:space-y-5">
            <ScoreCard />
            <AchievementsCard />
            <ProgressCard />
          </div>
        </div>
      </div>
    </div>
  );
}
