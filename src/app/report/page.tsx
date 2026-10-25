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
import { ChevronDown, CircleAlert, Info } from "lucide-react";
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
          "This browser could not read the saved report.",
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
          className="mx-auto w-full max-w-3xl pt-6 md:pt-10"
          aria-live="polite"
        >
          {reportState.status === "loading" ? (
            <p role="status" className="text-ink-soft">
              Loading your report...
            </p>
          ) : (
            <div key={reportState.status} className="rise">
              <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
                {isError ? "Report unavailable" : "No report yet"}
              </h1>
              <div
                className="alert-note mt-6"
                data-tone={isError ? undefined : "info"}
                style={{ animationDelay: "120ms" }}
              >
                {isError ? (
                  <CircleAlert
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-red-pencil"
                  />
                ) : (
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-pencil" />
                )}
                <div className="min-w-0 flex-1">
                  <p>
                    {isError
                      ? `${reportState.message} Return to the scenario to retry End conversation.`
                      : "Finish a conversation and your debrief lands here."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" className="rounded-lg">
                      <Link href="/scenario">
                        {isError ? "Return to scenario" : "Start scenario"}
                      </Link>
                    </Button>
                    {isError ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg"
                        onClick={loadReport}
                      >
                        Try loading again
                      </Button>
                    ) : null}
                    <Button asChild variant="ghost" size="sm" className="rounded-lg">
                      <Link href="/">Go home</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
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
            <section className="alert-note" role="status">
              <CircleAlert
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-red-pencil"
              />
              <div className="min-w-0 flex-1">
                <p>
                  <strong className="font-semibold">Partial report</strong>
                  {". "}Some sections could not be read; the rest is below.
                </p>
                <ul className="mt-1 text-xs text-ink-soft">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
              <Link
                href="/scenario"
                className="shrink-0 font-semibold text-pencil underline-offset-4 hover:underline"
              >
                Return to scenario
              </Link>
            </section>
          ) : null}
          <h1 className="rise text-4xl font-extrabold tracking-tight md:text-5xl">
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
            {evaluation.map((criterion, index) => (
              <ScoreBar
                key={criterion.category}
                category={criterion.category}
                score={criterion.score}
                delay={120 + index * 50}
              />
            ))}
          </div>
          <div
            className="rise max-w-3xl break-words text-lg leading-relaxed text-ink-soft"
            style={{ animationDelay: "380ms" }}
          >
            {summary ? (
              <ReportMarkdown>{summary}</ReportMarkdown>
            ) : (
              <p>No conversation summary is available for this report.</p>
            )}
          </div>
        </header>

        <aside
          className="rise space-y-6 print:hidden lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto"
          style={{ animationDelay: "300ms" }}
        >
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
              <div className="alert-note mt-3" data-tone="info">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-pencil" />
                <p className="min-w-0 flex-1">
                  This report cannot seed a follow-up. Finish a new
                  conversation to get one.
                </p>
              </div>
            ) : null}
            {followUpState.status === "loading" ? (
              <div key="loading" className="enter-pop mt-4 space-y-3">
                <p role="status">Generating your follow-up…</p>
                <div aria-hidden className="loading-sweep" />
                <Button
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => followUp.current?.cancel()}
                >
                  Cancel generation
                </Button>
              </div>
            ) : followUpState.status === "ready" ? (
              <div key="ready" className="enter-up mt-4 space-y-3">
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
                  <details className="smooth-details rounded-lg border border-rule p-3">
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
              <div key={followUpState.status} className="enter-pop mt-4 space-y-3">
                {followUpState.status === "error" ? (
                  <div role="alert" className="alert-note">
                    <CircleAlert
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-red-pencil"
                    />
                    <p className="min-w-0 flex-1">{followUpState.message}</p>
                  </div>
                ) : followUpState.message ? (
                  <p role="status" className="text-sm text-ink-soft">
                    {followUpState.message}
                  </p>
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
              <div role="alert" className="alert-note mt-3">
                <CircleAlert
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-red-pencil"
                />
                <p className="min-w-0 flex-1">{sessionError}</p>
              </div>
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
          className="rise min-w-0 rounded-xl border border-rule bg-white p-5 lg:col-start-1 lg:row-start-2"
          style={{ animationDelay: "420ms" }}
        >
          <SectionHeading open={isEvaluationOpen}>
            Skill by skill
          </SectionHeading>
          <CollapsibleContent className={collapsibleMotion}>
            <div className="pt-4">
              <EvaluationGrid criteria={evaluation} />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={isTranscriptOpen}
          onOpenChange={setIsTranscriptOpen}
          className="rise min-w-0 self-start rounded-xl border border-rule bg-white p-5 lg:col-start-1 lg:row-start-3"
          style={{ animationDelay: "480ms" }}
        >
          <SectionHeading open={isTranscriptOpen}>
            Annotated transcript
          </SectionHeading>
          <CollapsibleContent className={collapsibleMotion}>
            <div className="pt-4">
              <AnnotatedTranscript segments={segments} />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="print:hidden lg:col-start-1">
          <Button
            variant="outline"
            className="rounded-lg"
            onClick={() => {
              setIsEvaluationOpen(true);
              setIsTranscriptOpen(false);
              // Wait out the 200ms collapsible animation so print sees settled sections.
              setTimeout(() => {
                window.print();
              }, 250);
            }}
          >
            Print report
          </Button>
        </div>
      </div>
    </div>
  );
}

// overflow-clip, not hidden: hidden would make this a scroll container and
// detach the transcript notes' scroll-driven write-in from the page scroll.
const collapsibleMotion =
  "overflow-clip data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up";

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
          className={`size-5 text-ink-soft transition-transform duration-200 ease-out ${open ? "" : "-rotate-90"}`}
        />
      </CollapsibleTrigger>
    </h2>
  );
}
