"use client";

import ScenarioOverview from "@/components/ScenarioOverview";
import ScenarioVideo from "@/components/ScenarioVideo";
import { Scenarios } from "@/backend/src/lib/scenarios";
import SimpleChatPanel from "@/components/SimpleChatPanel";
import { SidePanelCedarChat } from "@/cedar/components/chatComponents/SidePanelCedarChat";
import { useState, useEffect, Suspense } from "react";
import MenuBar from "@/components/MenuBar";
import { mastraClient } from "@/lib/mastra-client";
import { useRouter, useSearchParams } from "next/navigation";
import { getScenarioFromLocalStorage } from "@/lib/scenarioUtil";
import { Scenario } from "@/lib/types";
import { Sentiment } from "@/lib/googleSentiment";
import { Progress } from "@/components/ui/progress";
import SentimentBar from "@/components/SentimentBar";

const scenario = Scenarios.negativeReview;

function ScenarioPageContent() {
  const [currentScenario, setCurrentScenario] = useState<Scenario>(scenario);
  const [scenarioCompleted, setScenarioCompleted] = useState(false);
  const [isLoadingNewScenario, setIsLoadingNewScenario] = useState(false);

  const searchParams = useSearchParams();

  useEffect(() => {
    const nextScenarioFlag = searchParams.get("next");
    if (nextScenarioFlag === "true") {
      const newScenario = getScenarioFromLocalStorage();
      if (newScenario) {
        setCurrentScenario(newScenario);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    checkScenarioCompletion();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkScenarioCompletion();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const checkScenarioCompletion = () => {
    const reportData = localStorage.getItem("reportData");
    const scenarioCompletedFlag = localStorage.getItem("scenarioCompleted");

    const scenesString = localStorage.getItem("numScenariosCompleted");
    if (scenesString) {
      localStorage.setItem(
        "numScenariosCompleted",
        (parseInt(scenesString) + 1).toString()
      );
    } else {
      localStorage.setItem("numScenariosCompleted", "1");
    }

    if (reportData && !scenarioCompleted && scenarioCompletedFlag === "true") {
      console.log("User has completed a scenario, generating new prompt...");
      setScenarioCompleted(true);
      generateNewScenarioPrompt();
    }
  };

  const generateNewScenarioPrompt = async () => {
    setIsLoadingNewScenario(true);
    try {
      const run = await mastraClient
        .getWorkflow("scenarioPipelineWorkflow")
        .createRunAsync();

      const result = await run.startAsync({
        inputData: {
          analysis: JSON.parse(localStorage.getItem("reportData") || "{}")[
            "analysis"
          ],
        },
      });
      console.log("result", result);
      localStorage.removeItem("scenarioCompleted");
      localStorage.setItem(
        "scenarioData",
        JSON.stringify({
          prompts: (result as any).result.prompts,
          reports: (result as any).result.reports,
          scenario: (result as any).result.scenario,
        })
      );
    } catch (error) {
      console.error("Failed to generate new scenario prompt:", error);
    } finally {
      setIsLoadingNewScenario(false);
    }
  };

  const [userSentiment, setUserSentiment] = useState<Sentiment>();
  const [botSentiment, setBotSentiment] = useState<Sentiment>();

  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    "landscape"
  );

  useEffect(() => {
    const updateOrientation = () => {
      if (window.innerWidth > window.innerHeight) {
        setOrientation("landscape");
      } else {
        setOrientation("portrait");
      }
    };

    window.addEventListener("resize", updateOrientation);
    updateOrientation(); // Call on mount

    return () => {
      window.removeEventListener("resize", updateOrientation);
    };
  }, []);

  if (orientation === "portrait") {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4 text-center">
        <h1 className="text-2xl font-bold mb-4">Please Rotate Your Device</h1>
        <p className="text-lg mb-16">
          For the best experience, please use this application in landscape
          mode.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-clip">
      <div className="flex w-screen" >
        <ScenarioOverview scenario={currentScenario} />
        <div className="flex flex-col flex-grow">
          {isLoadingNewScenario ? (
            <div className="w-full p-3 text-center bg-blue-100 border-b">
              <p className="font-medium text-blue-800">
                🔄 Generating new scenario based on your performance...
              </p>
            </div>
          ) : null}
          <div className="flex-grow relative flex items-center justify-center bg-black">
            <ScenarioVideo scenario={currentScenario} />
            <div className="absolute bottom-0 left-0 w-full z-20">
              <SentimentBar
                sentiment={userSentiment ? userSentiment.score : 0}
              />
            </div>
          </div>
        </div>
        <div className="w-[350px] flex flex-col items-end">
          <div
            className="w-full p-2 bg-white border-l"
            style={{ height: "calc(100vh - 3rem)" }}
          >
            <SidePanelCedarChat
              documents={currentScenario.documents}
              setUserSentiment={setUserSentiment}
              setBotSentiment={setBotSentiment}
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
