"use client";

import { Scenario } from "@/lib/types";

export default function ScenarioVideo({ scenario }: { scenario: Scenario }) {
  return (
    <div className="flex-grow bg-gray-200 flex flex-col">
      <video loop autoPlay muted>
        <source src="/BillLoop.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
