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

const scenario = Scenarios.demandingClient;

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

  // Check if user has completed a scenario on component mount
  useEffect(() => {
    checkScenarioCompletion();
  }, []);

  // Monitor for scenario completion (when user returns from report page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Page became visible - check if user just completed a scenario
        checkScenarioCompletion();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const checkScenarioCompletion = () => {
    // Check if there's report data (indicates completed scenario)
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
      // For now, we'll generate a mock prompt - replace this with actual backend call
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

  // Mock function to simulate backend scenario generation
  const generateMockScenarioPrompt = async (): Promise<string> => {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // This would be replaced with actual backend call
    return `
SCENARIO PROMPT:

Title: "Handling Team Conflict During Sprint Planning"

Situation: You are a Scrum Master at a growing tech startup. During today's sprint planning meeting, two senior developers (Sarah and Mike) are having a heated disagreement about the technical approach for a critical feature. Sarah advocates for a quick implementation using existing libraries, while Mike insists on building a custom solution for better performance. The rest of the team is watching tensely, and the Product Owner is getting impatient as the meeting runs over time.

Company Culture: The company values innovation, collaboration, and psychological safety. There's an emphasis on data-driven decisions and open communication, but also pressure to deliver features quickly to meet investor milestones.

Your Role: As Scrum Master, you need to facilitate a resolution that maintains team harmony while ensuring the project moves forward efficiently.

NPCs:
- Sarah Chen (Senior Frontend Developer): Pragmatic, deadline-focused, values proven solutions
- Mike Rodriguez (Senior Backend Developer): Performance-oriented, prefers custom solutions, detail-focused
- Alex Kim (Product Owner): Results-driven, business-focused, concerned about timeline

Key Challenges:
1. Mediate between conflicting technical opinions
2. Keep the meeting productive and on-track
3. Maintain team psychological safety
4. Balance technical excellence with business needs
5. Use Scrum principles to guide decision-making

Success Criteria:
- Reach a technical decision both developers can support
- Maintain positive team relationships
- Keep project timeline realistic
- Demonstrate effective Scrum Master facilitation skills
    `.trim();
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
      <div className="flex w-screen" style={{ height: "calc(100vh - 3rem)" }}>
        <ScenarioOverview scenario={currentScenario} />
        <div className="flex flex-col flex-grow">
          {isLoadingNewScenario ? (
            <div className="w-full p-3 text-center bg-blue-100 border-b">
              <p className="font-medium text-blue-800">
                🔄 Generating new scenario based on your performance...
              </p>
            </div>
          ) : (
            <div className="w-full text-center bg-white z-10">
              <div className="flex flex-col w-full gap-1">
                <SentimentBar
                  sentiment={userSentiment ? userSentiment.score : 0}
                />

                {/* {botSentiment && (
                  <SentimentBar label="Bill" sentiment={botSentiment.score} />
                )} */}
              </div>
            </div>
          )}
          {/*<div className="w-full p-2 text-center bg-white">
          <h1 className="text-2xl font-bold">Scenario: {scenario.title}</h1>
          <p>{scenario.goal}</p>
        </div> */}
          <div className="flex-grow flex items-center justify-center bg-black">
            <ScenarioVideo scenario={currentScenario} />
          </div>
        </div>
        <div className="w-[350px] flex flex-col items-end">
          <div
            className="w-full p-2 bg-white border-l"
            style={{ height: "calc(100vh - 3rem)" }}
          >
            {/* <SimpleChatPanel /> */}
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
