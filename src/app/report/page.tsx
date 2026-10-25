"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import EvaluationGrid from "@/components/EvaluationGrid";
import Parser, { type ParsedResult } from "./parser";
import AnnotatedTranscript, {
  ReportMarkdown,
} from "@/components/AnnotatedTranscript";
import TranscriptChatPanel from "@/components/TranscriptChatPanel";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { documentToString } from "@/lib/scenarioUtil";
import {
  createFollowUpController,
  followUpSource,
  type FollowUpSource,
  type FollowUpState,
} from "@/lib/followUp";
import { useSessionActions } from "@/components/SessionActionsProvider";
import { Button } from "@/components/ui/button";

type ReportState =
  | { status: "loading" | "empty" }
  | { status: "error"; message: string }
  | { status: "loaded"; report: ParsedResult; source?: FollowUpSource };

export default function ReportPage() {
  const [isSummaryOpen, setIsSummaryOpen] = useState(true);
  const [isEvaluationOpen, setIsEvaluationOpen] = useState(true);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(true);

  const [reportState, setReportState] = useState<ReportState>({
    status: "loading",
  });
  const [followUpState, setFollowUpState] = useState<FollowUpState>({
    status: "idle",
  });
  const followUp = useRef<ReturnType<typeof createFollowUpController> | null>(
    null,
  );
  const {
    startNewSession,
    isStarting,
    error: sessionError,
  } = useSessionActions();
  if (!followUp.current) {
    followUp.current = createFollowUpController({
      storage: () => localStorage,
      fetch: (...args) => fetch(...args),
      onState: setFollowUpState,
    });
  }

  const loadReport = useCallback(() => {
    try {
      const stored = localStorage.getItem("reportData");
      if (!stored) {
        followUp.current?.setSource(undefined);
        setReportState({ status: "empty" });
        return;
      }
      const report = Parser(stored);
      const source =
        report.status === "invalid" ? undefined : followUpSource(stored);
      followUp.current?.setSource(source);
      setReportState(
        report.status === "invalid"
          ? { status: "error", message: report.issues.join(" ") }
          : { status: "loaded", report, source },
      );
    } catch {
      followUp.current?.setSource(undefined);
      setReportState({
        status: "error",
        message:
          "This browser could not read the saved report. Check that browser storage is available, then try loading it again.",
      });
    }
  }, []);

  useEffect(() => {
    loadReport();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "reportData" || event.key === null) loadReport();
    };
    if (typeof window !== "undefined")
      window.addEventListener("storage", onStorage);
    return () => {
      if (typeof window !== "undefined")
        window.removeEventListener("storage", onStorage);
      followUp.current?.cancel(false);
    };
  }, [loadReport]);

  if (reportState.status !== "loaded") {
    const isError = reportState.status === "error";
    return (
      <div className="min-h-screen bg-gray-50 p-5">
        <section
          className="mx-auto w-full max-w-6xl rounded-md bg-white p-6 shadow-md"
          aria-live="polite"
        >
          {reportState.status === "loading" ? (
            <p role="status">Loading your report...</p>
          ) : (
            <>
              <h1 className="text-2xl font-bold">
                {isError ? "Report unavailable" : "No report yet"}
              </h1>
              <p className="mt-3 max-w-2xl text-gray-700">
                {isError
                  ? reportState.message
                  : "Complete a scenario to see feedback from your conversation here."}
              </p>
              {isError ? (
                <p className="mt-2 max-w-2xl text-gray-700">
                  Return to the scenario to retry End Scenario, or choose
                  another scenario from Home.
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/scenario">
                    {isError ? "Return to Scenario" : "Start Scenario"}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/">Go to Home</Link>
                </Button>
                {isError ? (
                  <Button variant="outline" onClick={loadReport}>
                    Try Loading Again
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  const {
    summary,
    feedback,
    suggestions,
    scores,
    evaluation,
    segments,
    status,
    issues,
  } = reportState.report;

  return (
    <div className="flex flex-col items-center min-h-screen font-sans bg-gray-50">
      <div
        id="report-content"
        className="flex flex-col w-full max-w-6xl p-5 space-y-5"
      >
        {status === "partial" ? (
          <section
            className="rounded-md bg-amber-50 p-4 text-amber-950"
            role="status"
          >
            <h1 className="text-lg font-semibold">Partial report</h1>
            <p className="mt-1">Available feedback is shown below.</p>
            <ul className="mt-2 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <Link
              href="/scenario"
              className="mt-3 inline-block font-medium underline underline-offset-4"
            >
              Return to Scenario
            </Link>
          </section>
        ) : null}
        <section
          className="rounded-md bg-white p-5 shadow-md"
          aria-labelledby="follow-up-heading"
        >
          <h2 id="follow-up-heading" className="text-2xl font-bold">
            Practice your next conversation
          </h2>
          <p className="mt-2 text-gray-700">
            Generate a follow-up from this report’s feedback, then review it
            before starting.
          </p>
          {!reportState.source ? (
            <p className="mt-3 text-gray-700">
              This report does not contain the session and analysis needed for a
              follow-up. Complete another scenario to generate one.
            </p>
          ) : null}
          {followUpState.status === "loading" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p role="status">Generating your follow-up…</p>
              <Button
                variant="outline"
                onClick={() => followUp.current?.cancel()}
              >
                Cancel Generation
              </Button>
            </div>
          ) : followUpState.status === "ready" ? (
            <div className="mt-4 space-y-3">
              <h3 className="text-xl font-semibold">
                {followUpState.scenario.title}
              </h3>
              <p>{followUpState.scenario.situation}</p>
              <p>
                <strong>Goal:</strong> {followUpState.scenario.goal}
              </p>
              <p>
                <strong>Your role:</strong> {followUpState.scenario.userRole}
              </p>
              {followUpState.scenario.documents.length ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer font-medium">
                    Preview supporting documents (
                    {followUpState.scenario.documents.length})
                  </summary>
                  <div className="mt-3 space-y-4">
                    {followUpState.scenario.documents.map((doc, index) => (
                      <div
                        key={`${doc.title}-${index}`}
                        className="break-words"
                      >
                        <ReportMarkdown>{documentToString(doc)}</ReportMarkdown>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={isStarting}
                  onClick={() => {
                    void startNewSession(followUpState.scenario).catch(
                      () => {},
                    );
                  }}
                >
                  {isStarting ? "Starting Follow-up…" : "Start Follow-up"}
                </Button>
                <Button
                  variant="outline"
                  disabled={isStarting}
                  onClick={() => {
                    void followUp.current?.generate();
                  }}
                >
                  Regenerate Follow-up
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {followUpState.status === "error" ? (
                <p role="alert" className="text-red-700">
                  {followUpState.message}
                </p>
              ) : followUpState.message ? (
                <p role="status">{followUpState.message}</p>
              ) : null}
              <Button
                disabled={!reportState.source || isStarting}
                onClick={() => {
                  void followUp.current?.generate();
                }}
              >
                {followUpState.status === "error"
                  ? "Retry Follow-up"
                  : "Generate Follow-up"}
              </Button>
            </div>
          )}
          {sessionError ? (
            <p role="alert" className="mt-3 text-red-700">
              {sessionError}
            </p>
          ) : null}
        </section>

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
            {summary ? (
              <ReportMarkdown>{summary}</ReportMarkdown>
            ) : (
              <p>No conversation summary is available for this report.</p>
            )}
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
          <CollapsibleContent className="mt-4">
            <EvaluationGrid criteria={evaluation} />
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
                  scores={scores}
                />
              </div>

              <div className="flex-[2] min-w-0">
                <AnnotatedTranscript segments={segments} />
              </div>

              {/* Right side - Transcript Chat */}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <button
        onClick={() => {
          setIsEvaluationOpen(true);
          setIsTranscriptOpen(false);
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
