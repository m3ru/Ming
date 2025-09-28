"use client";
import { useState, useEffect, useRef } from "react";
import ScoreBar from "@/components/ScoreBar";
import { marked } from "marked";
import MenuBar from "@/components/MenuBar";
import Parser from "./parser";
import AnnotatedTranscript from "@/components/AnnotatedTranscript";
import TranscriptChatPanel from "@/components/TranscriptChatPanel";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Scenario } from "@/lib/types";
import { getScenarioFromLocalStorage, parseScenario } from "@/lib/scenarioUtil";
import { Button } from "@/components/ui/button";

const defaultScores = [
  { category: "Empathy", score: 85 },
  { category: "Clarity", score: 90 },
  { category: "Open-mindedness", score: 80 },
  { category: "Assertiveness", score: 75 },
  { category: "Active Listening", score: 88 },
  { category: "Conflict Management", score: 99 },
];

export default function ReportPage() {
  const reportRef = useRef<HTMLDivElement | null>(null);

  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isEvaluationOpen, setIsEvaluationOpen] = useState(true);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(true);
  const [isNextScenarioOpen, setIsNextScenarioOpen] = useState(false);

  const [summary, setSummary] = useState<string>("Loading AI Summary...");
  const [feedback, setFeedback] = useState<string>("Loading AI Feedback...");
  const [scoring, setScores] = useState<typeof defaultScores>(defaultScores);
  const [suggestions, setSuggestions] = useState<string>(
    "Loading AI Suggestions..."
  );
  const [segments, setSegments] = useState<
    { title: string; content: string }[]
  >([]);

  // Load localStorage data
  useEffect(() => {
    const stored = localStorage.getItem("reportData"); // This is the raw string from the backend
    if (!stored) {
      return;
    }
    const data = Parser(stored || "");
    setSummary(data.summary || "No summary found.");
    setFeedback(data.feedback || "No feedback found.");
    setSegments(data.segments || []);
    setSuggestions(data.suggestions || "No suggestions found.");
    setScores(data.scores || defaultScores);
    localStorage.setItem("prevScores", localStorage.getItem("scores") || JSON.stringify(defaultScores));
    localStorage.setItem("scores", JSON.stringify(data.scores));
  }, []);

  const [nextScenario, setNextScenario] = useState<Scenario>();

  useEffect(() => {
    setNextScenario(getScenarioFromLocalStorage());
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen font-sans bg-gray-50">
      <div
        ref={reportRef}
        id="report-content"
        className="flex flex-col w-full max-w-6xl p-5 space-y-5"
      >
        {/* Summary */}
        <Collapsible
          open={isSummaryOpen}
          onOpenChange={setIsSummaryOpen}
          className="p-3 bg-white rounded-md shadow-md"
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
            <h2 className="flex-grow text-2xl font-bold text-center">
              Conversation Summary
            </h2>
            {isSummaryOpen ? (
              <ChevronUp className="w-6 h-6" />
            ) : (
              <ChevronDown className="w-6 h-6" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 max-h-[300px] overflow-auto break-words">
            <div dangerouslySetInnerHTML={{ __html: marked.parse(summary) }} />
          </CollapsibleContent>
        </Collapsible>

        {/* Scoring */}
        <Collapsible
          open={isEvaluationOpen}
          onOpenChange={setIsEvaluationOpen}
          className="p-3 bg-white rounded-md shadow-md"
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
            <h2 className="flex-grow text-2xl font-bold text-center">
              Evaluation
            </h2>
            {isEvaluationOpen ? (
              <ChevronUp className="w-6 h-6" />
            ) : (
              <ChevronDown className="w-6 h-6" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 max-h-[500px] overflow-auto break-words">
            <div
              className="mb-3"
              dangerouslySetInnerHTML={{ __html: marked.parse(feedback) }}
            />

            <div className="flex gap-4">
              <div className="flex-1">
                <ScoreBar
                  category={scoring[0].category}
                  score={scoring[0].score}
                />
                <ScoreBar
                  category={scoring[2].category}
                  score={scoring[2].score}
                />
                <ScoreBar
                  category={scoring[4].category}
                  score={scoring[4].score}
                />
              </div>
              <div className="flex-1">
                <ScoreBar
                  category={scoring[1].category}
                  score={scoring[1].score}
                />
                <ScoreBar
                  category={scoring[3].category}
                  score={scoring[3].score}
                />
                <ScoreBar
                  category={scoring[5].category}
                  score={scoring[5].score}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Suggestions */}
        <Collapsible
          open={isSuggestionsOpen}
          onOpenChange={setIsSuggestionsOpen}
          className="p-3 bg-white rounded-md shadow-md"
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
            <h2 className="flex-grow text-2xl font-bold text-center">
              Suggested Improvements
            </h2>
            {isSuggestionsOpen ? (
              <ChevronUp className="w-6 h-6" />
            ) : (
              <ChevronDown className="w-6 h-6" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 max-h-[450px] overflow-auto break-words">
            <div
              dangerouslySetInnerHTML={{ __html: marked.parse(suggestions) }}
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Annotated Transcript with Chat */}
        <Collapsible
          open={isTranscriptOpen}
          onOpenChange={setIsTranscriptOpen}
          className="p-3 bg-white rounded-md shadow-md"
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
            <h2 className="flex-grow text-2xl font-bold text-center">
              Annotated Transcript + Q&A
            </h2>
            {isTranscriptOpen ? (
              <ChevronUp className="w-6 h-6" />
            ) : (
              <ChevronDown className="w-6 h-6" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <div className="flex min-h-[500px]">
              {/* Left side - Annotated Transcript */}

              <div className="max-md:hidden flex-[1] md:min-w-[300px]">
                <TranscriptChatPanel
                  segments={segments}
                  feedback={feedback}
                  suggestions={suggestions}
                  scores={scoring}
                />
              </div>

              <div className="flex-[2] min-w-0">
                <AnnotatedTranscript segments={segments} />
              </div>

              {/* Right side - Transcript Chat */}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Next Scenario */}
        {nextScenario && (
          <Collapsible
            open={isNextScenarioOpen}
            onOpenChange={setIsNextScenarioOpen}
            className="p-3 bg-white rounded-md shadow-md"
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
              <h2 className="flex-grow text-2xl font-bold text-center">
                Next Scenario: {nextScenario.title}
              </h2>
              {isNextScenarioOpen ? (
                <ChevronUp className="w-6 h-6" />
              ) : (
                <ChevronDown className="w-6 h-6" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 flex flex-col gap-2">
              <div>{nextScenario.situation}</div>
              <div>
                <strong>Goal:</strong> {nextScenario.goal}
              </div>
              <div>
                <strong>Your Role:</strong> {nextScenario.userRole}
              </div>
              <Button
                onClick={() => (window.location.href = `/scenario?next=true`)}
                className="cursor-pointer"
              >
                Start Next Scenario
              </Button>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <button
        onClick={() => {
          setIsEvaluationOpen(true);
          setIsTranscriptOpen(true);
          setIsSuggestionsOpen(true);
          setIsSummaryOpen(true);
          setTimeout(() => {
            window.print();
          }, 100);
        }}
        className="px-3 py-1 mb-6 bg-gray-100 font-medium border shadow border-gray-300 text-black rounded-md"
      >
        Print/Export Report
      </button>
    </div>
  );
}
