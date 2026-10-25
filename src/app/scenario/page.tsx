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
import useOrientation from "@/hooks/useOrientation";

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
          "This browser could not load the active scenario. Return Home and start a new session, or allow site storage and reload this page.",
      });
    }
  }, []);

  const [userSentiment, setUserSentiment] = useState<Sentiment>();

  const orientation = useOrientation();

  // Do not mount chat or voice with the default context while saved context is loading.
  if (!loaded)
    return (
      <p className="p-6" role="status">
        Loading your scenario…
      </p>
    );
  if ("error" in loaded)
    return (
      <section className="mx-auto mt-8 max-w-2xl rounded-md bg-white p-6 shadow-md">
        <h1 className="text-2xl font-bold">Scenario unavailable</h1>
        <p role="alert" className="mt-3">
          {loaded.error}
        </p>
        <Link href="/" className="mt-4 inline-block font-medium underline">
          Return Home
        </Link>
      </section>
    );
  const currentScenario = loaded.scenario;

  if (orientation === "portrait") {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <h1 className="text-2xl font-bold mb-4">Please Rotate Your Device</h1>
        <p className="text-lg mb-16">
          For the best experience, please use this application in landscape
          mode.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-clip" style={{ height: "calc(100vh - 3rem)" }}>
      <div className="flex w-full h-full">
        <ScenarioOverview scenario={currentScenario} />
        <div className="flex flex-col flex-grow">
          <div
            className="flex-grow relative flex items-center justify-center bg-black"
            style={{ height: "calc(100vh - 3rem)" }}
          >
            <ScenarioVideo scenario={currentScenario} />
            <div className="absolute bottom-0 left-0 w-full z-20">
              <SentimentBar
                sentiment={userSentiment ? userSentiment.score : 0}
              />
            </div>
          </div>
        </div>
        <div className="w-[350px] flex flex-col items-end">
          <div className="w-full p-2 bg-white border-l h-full">
            <SidePanelCedarChat
              scenario={currentScenario}
              documents={currentScenario.documents}
              setUserSentiment={setUserSentiment}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScenarioPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ScenarioPageContent />
    </Suspense>
  );
}
