"use client";

import ScenarioOverview from "@/components/ScenarioOverview";
import ScenarioVideo from "@/components/ScenarioVideo";
import { Scenarios } from "@/backend/src/lib/scenarios";
import { SidePanelCedarChat } from "@/cedar/components/chatComponents/SidePanelCedarChat";
import { useState, useEffect, Suspense } from "react";
import { readActiveScenario } from "@/lib/practiceSession";
import Link from "next/link";
import { Scenario } from "@/lib/types";
import type { Sentiment } from "@/lib/sentiment";
import SentimentBar from "@/components/SentimentBar";

const scenario = Scenarios.negativeReview;

function ScenarioPageContent() {
  const [loaded, setLoaded] = useState<
    { scenario: Scenario } | { error: string }
  >();

  useEffect(() => {
    try {
      setLoaded({ scenario: readActiveScenario() ?? scenario });
    } catch {
      setLoaded({
        error:
          "This browser could not load the active scenario. Return home and start a new session, or allow site storage and reload this page.",
      });
    }
  }, []);

  const [userSentiment, setUserSentiment] = useState<Sentiment>();

  // Do not mount chat or voice with the default context while saved context is loading.
  if (!loaded)
    return (
      <p className="p-6 text-ink-soft" role="status">
        Loading your scenario…
      </p>
    );
  if ("error" in loaded)
    return (
      <section className="m-4 max-w-2xl rounded-xl border border-rule bg-white p-6 sm:mx-auto sm:mt-8">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Scenario unavailable
        </h1>
        <p role="alert" className="mt-3 text-ink-soft">
          {loaded.error}
        </p>
        <Link
          href="/"
          className="mt-4 inline-block font-semibold text-pencil underline underline-offset-4"
        >
          Return home
        </Link>
      </section>
    );
  const currentScenario = loaded.scenario;

  // Stacked and page-scrolling below lg; three fixed-height columns from lg up.
  return (
    <div className="flex flex-col gap-4 p-4 lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[18rem_minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_25rem]">
      <ScenarioOverview scenario={currentScenario} />
      <div className="flex min-h-0 flex-col gap-4">
        <ScenarioVideo scenario={currentScenario} />
        <SentimentBar sentiment={userSentiment ? userSentiment.score : 0} />
      </div>
      <SidePanelCedarChat
        scenario={currentScenario}
        documents={currentScenario.documents}
        setUserSentiment={setUserSentiment}
      />
    </div>
  );
}

export default function ScenarioPage() {
  return (
    <Suspense fallback={<p className="p-6 text-ink-soft">Loading…</p>}>
      <ScenarioPageContent />
    </Suspense>
  );
}
