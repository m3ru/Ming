"use client";

import { Npc, Scenario } from "@/lib/types";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { useState } from "react";
import { CollapsibleTrigger } from "@radix-ui/react-collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "./ui/card";
import { Avatar } from "@radix-ui/react-avatar";
import { AvatarFallback, AvatarImage } from "./ui/avatar";

const pfpUrl =
  "https://lh3.googleusercontent.com/a/ACg8ocKJekIDEXvk6_sZFABBLKojvPCwQVqspj9kkjo1oLRBNpreHXrk=s83-c-mo";

function NpcOverview({ npc }: { npc: Npc }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card>
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="flex flex-col"
      >
        <CollapsibleTrigger className="cursor-pointer">
          <div className="flex w-full justify-between items-center px-4 py-1">
            <div className="flex items-center gap-1">
              <Avatar className="rounded-lg w-8 h-8">
                <AvatarImage src={pfpUrl} className="rounded-full" />
                <AvatarFallback>{npc.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start">
                <h3 className="font-bold">{npc.name}</h3>
                <p className="text-sm">{npc.role}</p>
              </div>
            </div>
            {isOpen ? <ChevronDown /> : <ChevronUp />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="p-4 pt-0 flex flex-col gap-2">
          <p>
            <strong>Scenario:</strong> {npc.scenarioSpecificInfo}
          </p>
          <p>
            <strong>Personality:</strong> {npc.personality}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function ScenarioOverview({ scenario }: { scenario: Scenario }) {
  const [isCompanyCultureOpen, setIsCompanyCultureOpen] = useState(false);

  return (
    <div className="flex flex-col p-5 w-1/5 gap-2 overflow-y-scroll border-r">
      <h1 className="text-2xl font-bold">Scenario</h1>
      <p>{scenario.situation}</p>
      <Collapsible
        open={isCompanyCultureOpen}
        onOpenChange={setIsCompanyCultureOpen}
        className="flex flex-col"
      >
        <CollapsibleTrigger className="cursor-pointer">
          <div className="flex w-full justify-between">
            <h2 className="text-lg font-bold">Company Culture</h2>
            {isCompanyCultureOpen ? <ChevronDown /> : <ChevronUp />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p>{scenario.companyCulture}</p>
        </CollapsibleContent>
      </Collapsible>
      <h2 className="text-lg font-bold">Coworkers</h2>
      {scenario.npcs.length === 0 ? (
        <p>No coworkers in this scenario.</p>
      ) : (
        scenario.npcs.map((npc, index) => <NpcOverview key={index} npc={npc} />)
      )}
    </div>
  );
}
