"use client";

import { Scenario } from "@/lib/types";

export default function ScenarioVideo({ scenario }: { scenario: Scenario }) {
  return (
    <div className="relative aspect-video shrink-0 overflow-hidden rounded-2xl bg-muted shadow-lg shadow-ink/10 lg:aspect-auto lg:min-h-0 lg:flex-1">
      <video
        loop
        autoPlay
        muted
        playsInline
        aria-label={`${scenario.title} character video`}
        className="absolute inset-0 size-full object-cover"
      >
        <source src="/BillyLoop.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
