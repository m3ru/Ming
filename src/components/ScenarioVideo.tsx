"use client";

import { Scenario } from "@/lib/types";

export default function ScenarioVideo({ scenario }: { scenario: Scenario }) {
  return (
    <div className="flex-grow flex flex-col justify-end" style={{ maxHeight: 'calc(100vh - 3rem)' }}>
      <video loop autoPlay muted>
        <source src="/BillyLoop.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
