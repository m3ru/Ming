"use client";

import { Scenario } from "@/lib/types";
import { Avatar } from "@radix-ui/react-avatar";
import { AvatarFallback, AvatarImage } from "./ui/avatar";

export default function ScenarioVideo({ scenario }: { scenario: Scenario }) {
  return (
    <div className="flex-grow bg-gray-200 flex flex-col">
      {scenario.npcs.length == 0 ? (
        <p className="m-auto text-gray-500">No coworkers in this scenario.</p>
      ) : (
        scenario.npcs.map((npc, index) => (
          <div
            key={index}
            className="flex-grow flex flex-col items-center justify-center"
          >
            <Avatar>
              <AvatarImage src={npc.pfp} className="rounded-full" />
              <AvatarFallback>{npc.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="text-2xl font-bold text-center">{npc.name}</div>
          </div>
        ))
      )}
    </div>
  );
}
