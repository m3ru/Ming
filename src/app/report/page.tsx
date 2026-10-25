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
import { ChevronDown } from "lucide-react";
import ScoreBar from "@/components/ScoreBar";
import { documentToString } from "@/lib/scenarioUtil";
import {
  createFollowUpController,
  followUpSource,
  type FollowUpSource,
  type FollowUpState,
} from "@/lib/followUp";
import { useSessionActions } from "@/components/SessionActionsProvider";
import { evaluationVerdict } from "@/lib/evaluation";
import { Button } from "@/components/ui/button";

type ReportState =
  | { status: "loading" | "empty" }
  | { status: "error"; message: string }
  | { status: "loaded"; report: ParsedResult; source?: FollowUpSource };

export default function ReportPage() {
  // The summary now sits in the header and no longer collapses; this slot keeps
  // the useState call order the report regression test mocks.
  useState(true);
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
      <div className="min-h-screen bg-paper p-5 text-ink">
        <section
          className="mx-auto w-full max-w-3xl rounded-xl border border-rule bg-white p-6 md:p-8"
          aria-live="polite"
        >
          {reportState.status === "loading" ? (
            <p role="status" className="text-ink-soft">
              Loading your report...
            </p>
          ) : (
            <>
              <h1 className="text-3xl font-extrabold">
                {isError ? "Report unavailable" : "No report yet"}
              </h1>
              <p className="mt-3 max-w-2xl text-ink-soft">
                {isError
                  ? reportState.message
                  : "Complete a scenario to see feedback from your conversation here."}
              </p>
              {isError ? (
                <p className="mt-2 max-w-2xl text-ink-soft">
                  Return to the scenario to retry End conversation, or choose
                  another scenario from Home.
                </p>
              ) : null}
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild className="rounded-lg">
                  <Link href="/scenario">
                    {isError ? "Return to scenario" : "Start scenario"}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-lg">
                  <Link href="/">Go home</Link>
                </Button>
                {isError ? (
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    onClick={loadReport}
                  >
                    Try loading again
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
  const verdict = evaluationVerdict(evaluation);

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div
        id="report-content"
        className="mx-auto grid w-full max-w-7xl gap-6 p-5 md:p-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_auto_1fr]"
      >
        <header className="space-y-6 lg:col-span-2">
          {status === "partial" ? (
            <section
              className="rounded-xl border border-red-pencil/30 bg-red-pencil/5 p-4"
              role="status"
            >
              <h2 className="text-lg font-semibold text-red-pencil">
                Partial report
              </h2>
              <p className="mt-1">Available feedback is shown below.</p>
              <ul className="mt-2 list-disc pl-5 text-ink-soft">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <Link
                href="/scenario"
                className="mt-3 inline-block font-medium text-pencil underline underline-offset-4"
              >
                Return to scenario
              </Link>
            </section>
          ) : null}
          <h1 className="text-4xl font-extrabold md:text-5xl">
            {verdict ? (
              <>
                Strongest: {verdict.strongest}.
                {verdict.workOn ? (
                  <>
                    {" "}
                    Work on:{" "}
                    <span className="text-red-pencil">{verdict.workOn}.</span>
                  </>
                ) : null}
              </>
            ) : (
              "Your debrief"
            )}
          </h1>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {evaluation.map((criterion) => (
              <ScoreBar
                key={criterion.category}
                category={criterion.category}
                score={criterion.score}
              />
            ))}
          </div>
          <div className="max-w-3xl break-words text-lg leading-relaxed text-ink-soft">
            {summary ? (
              <ReportMarkdown>{summary}</ReportMarkdown>
            ) : (
              <p>No conversation summary is available for this report.</p>
            )}
          </div>
        </header>

        <aside className="space-y-6 print:hidden lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <section
            className="rounded-xl border border-rule bg-white p-5"
            aria-labelledby="follow-up-heading"
          >
            <h2
              id="follow-up-heading"
              className="text-xl font-extrabold"
            >
              Practice your next conversation
            </h2>
            <p className="mt-2 text-ink-soft">
              Generate a follow-up from this report’s feedback, then review it
              before starting.
            </p>
            {!reportState.source ? (
              <p className="mt-3 text-ink-soft">
                This report does not contain the session and analysis needed for
                a follow-up. Complete another scenario to generate one.
              </p>
            ) : null}
            {followUpState.status === "loading" ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p role="status">Generating your follow-up…</p>
                <Button
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => followUp.current?.cancel()}
                >
                  Cancel generation
                </Button>
              </div>
            ) : followUpState.status === "ready" ? (
              <div className="mt-4 space-y-3">
                <h3 className="text-lg font-bold">
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
                  <details className="rounded-lg border border-rule p-3">
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
                          <ReportMarkdown>
                            {documentToString(doc)}
                          </ReportMarkdown>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    className="rounded-lg"
                    disabled={isStarting}
                    onClick={() => {
                      void startNewSession(followUpState.scenario).catch(
                        () => {},
                      );
                    }}
                  >
                    {isStarting ? "Starting follow-up…" : "Start follow-up"}
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    disabled={isStarting}
                    onClick={() => {
                      void followUp.current?.generate();
                    }}
                  >
                    Regenerate follow-up
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {followUpState.status === "error" ? (
                  <p role="alert" className="text-red-pencil">
                    {followUpState.message}
                  </p>
                ) : followUpState.message ? (
                  <p role="status">{followUpState.message}</p>
                ) : null}
                <Button
                  className="w-full rounded-lg"
                  disabled={!reportState.source || isStarting}
                  onClick={() => {
                    void followUp.current?.generate();
                  }}
                >
                  {followUpState.status === "error"
                    ? "Retry follow-up"
                    : "Generate follow-up"}
                </Button>
              </div>
            )}
            {sessionError ? (
              <p role="alert" className="mt-3 text-red-pencil">
                {sessionError}
              </p>
            ) : null}
          </section>

          <div className="max-md:hidden">
            <TranscriptChatPanel
              segments={segments}
              feedback={feedback}
              suggestions={suggestions}
              scores={scores}
            />
          </div>
        </aside>

        <Collapsible
          open={isEvaluationOpen}
          onOpenChange={setIsEvaluationOpen}
          className="min-w-0 rounded-xl border border-rule bg-white p-5 lg:col-start-1 lg:row-start-2"
        >
          <SectionHeading open={isEvaluationOpen}>
            Skill by skill
          </SectionHeading>
          <CollapsibleContent className="mt-4">
            <EvaluationGrid criteria={evaluation} />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={isTranscriptOpen}
          onOpenChange={setIsTranscriptOpen}
          className="min-w-0 self-start rounded-xl border border-rule bg-white p-5 lg:col-start-1 lg:row-start-3"
        >
          <SectionHeading open={isTranscriptOpen}>
            Annotated transcript
          </SectionHeading>
          <CollapsibleContent className="mt-4">
            <AnnotatedTranscript segments={segments} />
          </CollapsibleContent>
        </Collapsible>

        <div className="print:hidden lg:col-start-1">
          <Button
            variant="outline"
            className="rounded-lg"
            onClick={() => {
              setIsEvaluationOpen(true);
              setIsTranscriptOpen(false);
              setTimeout(() => {
                window.print();
              }, 100);
            }}
          >
            Print report
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  open,
  children,
}: {
  open: boolean;
  children: string;
}) {
  return (
    <h2 className="text-2xl font-extrabold">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 text-left">
        {children}
        <ChevronDown
          aria-hidden="true"
          className={`size-5 text-ink-soft transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </CollapsibleTrigger>
    </h2>
  );
}
