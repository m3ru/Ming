"use client";

import ScenarioOverview from "@/components/ScenarioOverview";
import ScenarioVideo from "@/components/ScenarioVideo";
import { Scenarios } from "@/backend/src/lib/scenarios";
import SimpleChatPanel from "@/components/SimpleChatPanel";
import { SidePanelCedarChat } from "@/cedar/components/chatComponents/SidePanelCedarChat";

const scenario = Scenarios.demandingClient;

export default function ScenarioPage() {
  return (
    <div className="h-screen w-screen flex">
      <ScenarioOverview scenario={scenario} />
      <div className="flex-grow flex flex-col">
        <div className="w-full p-2 text-center bg-white">
          <h1 className="text-2xl font-bold">Scenario: {scenario.title}</h1>
          <p>{scenario.goal}</p>
        </div>
        <ScenarioVideo scenario={scenario} />
      </div>
      <div className="w-[350px] flex flex-col items-end">
        <div className="h-full p-4 bg-white rounded shadow w-full">
          {/* <SimpleChatPanel /> */}
          <SidePanelCedarChat documents={scenario.documents} />
        </div>
      </div>
    </div>
  );
}
