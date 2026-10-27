"use client";

import ScenarioOverview from "@/components/ScenarioOverview";
import ScenarioVideo from "@/components/ScenarioVideo";
import LiveAvatar from "@/components/LiveAvatar";
import { useLiveAvatarProvider } from "@/hooks/useLiveAvatar";
import { Scenarios } from "@/backend/src/lib/scenarios";
import { SidePanelCedarChat } from "@/cedar/components/chatComponents/SidePanelCedarChat";
import { useState, useEffect, Suspense } from "react";
import { readActiveScenario } from "@/lib/practiceSession";
import Link from "next/link";
import { Scenario } from "@/lib/types";
import type { Sentiment } from "@/lib/sentiment";
import SentimentBar from "@/components/SentimentBar";
import { CircleAlert } from "lucide-react";

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
        error: "Your saved scenario could not be loaded. Start a new session from home.",
      });
    }
  }, []);

  const [userSentiment, setUserSentiment] = useState<Sentiment>();
  const liveAvatar = useLiveAvatarProvider();

  // Do not mount chat or voice with the default context while saved context is loading.
  if (!loaded)
    return (
      <div className="mx-auto max-w-xs space-y-3 p-6 pt-16" role="status">
        <p className="text-ink-soft">Loading your scenario…</p>
        <div aria-hidden className="loading-sweep" />
      </div>
    );
  if ("error" in loaded)
    return (
      <section className="rise m-4 max-w-2xl sm:mx-auto sm:mt-10">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Scenario unavailable
        </h1>
        <div
          role="alert"
          className="alert-note mt-5"
          style={{ animationDelay: "120ms" }}
        >
          <CircleAlert
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-red-pencil"
          />
          <p className="min-w-0 flex-1">{loaded.error}</p>
          <Link
            href="/"
            className="shrink-0 font-semibold text-pencil underline-offset-4 hover:underline"
          >
            Return home
          </Link>
        </div>
      </section>
    );
  const currentScenario = loaded.scenario;

  // Stacked and page-scrolling below lg; three fixed-height columns from lg up.
  return (
    <div className="flex flex-col gap-4 p-4 lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[18rem_minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_25rem]">
      <ScenarioOverview scenario={currentScenario} />
      <div className="flex min-h-0 flex-col gap-4">
        {liveAvatar ? (
          <LiveAvatar scenario={currentScenario} />
        ) : (
          <ScenarioVideo scenario={currentScenario} />
        )}
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
