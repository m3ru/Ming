import ScenarioOverview from "@/components/ScenarioOverview";
import { Scenarios } from "@/lib/scenarios";

const scenario = Scenarios.demandingClient;

export default function ScenarioPage() {
  return (
    <div className="h-screen w-screen flex">
      <ScenarioOverview scenario={scenario} />
      <div className="flex-grow bg-gray-200 flex flex-col">
        <div className="w-full p-2 text-2xl font-bold text-center bg-white">
          Scenario: {scenario.title}
        </div>
      </div>
    </div>
  );
}
