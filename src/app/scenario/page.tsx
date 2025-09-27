"use client";

import ScenarioOverview from "@/components/ScenarioOverview";
import ScenarioVideo from "@/components/ScenarioVideo";
import { Scenarios } from "@/lib/scenarios";
import { SidePanelCedarChat } from "@/cedar/components/chatComponents/SidePanelCedarChat";
import SimpleChatPanel from "@/components/SimpleChatPanel";

const scenario = Scenarios.demandingClient;

export default function ScenarioPage() {
  return (
    <div className="h-screen w-screen flex">
      <ScenarioOverview scenario={scenario} />
      <div className="flex-grow flex flex-col">
        <div className="w-full p-2 text-2xl font-bold text-center bg-white">
          Scenario: {scenario.title}
        </div>
        <ScenarioVideo scenario={scenario} />
      </div>
      <div className="w-[350px] flex flex-col items-end">
        <div className="h-full p-4 bg-white rounded shadow w-full">
          <SimpleChatPanel />
        </div>
      </div>
    </div>
  );
}
