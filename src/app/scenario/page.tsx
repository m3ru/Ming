import ScenarioOverview from "@/components/ScenarioOverview";
import { Scenario } from "@/lib/types";

export default function ScenarioPage() {
  const scenario: Scenario = {
    title: "Difficult Client Meeting",
    situation:
      "You are a project manager at a tech company. You have a meeting with a client who is unhappy with the progress of the project. The client is demanding more features and a faster timeline, but your team is already stretched thin.",
    companyCulture:
      "Your company values transparency, collaboration, and work-life balance. Employees are encouraged to speak up and share their ideas, but there is also a strong emphasis on meeting deadlines and delivering high-quality work.",
    npcs: [
      {
        name: "Bill",
        role: "Developer",
        personality:
          "Bill is an analytical thinker who values logic and efficiency, sometimes at the expense of interpersonal relationships.",
        scenarioSpecificInfo:
          "Bill is frustrated with the unrealistic expectations of the client. He feels that the client doesn't understand the technical challenges involved in the project.",
      },
      {
        name: "Susan",
        role: "Designer",
        personality:
          "Susan is a creative and empathetic individual who prioritizes user experience and aesthetics, often advocating for the end-user's perspective.",
        scenarioSpecificInfo:
          "Susan is trying to balance the client's demands with the team's capacity. She believes that the client needs to be educated about the design process.",
      },
    ],
  };

  return (
    <div className="h-screen w-screen flex">
      <ScenarioOverview scenario={scenario} />
      <div className="flex-grow bg-gray-200">Scenario Page</div>
    </div>
  );
}
