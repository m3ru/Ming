"use client";

import {
  Npc,
  Scenario,
  ScenarioDocument,
  ScenarioDocumentBlock,
} from "@/lib/types";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { useState } from "react";
import { CollapsibleTrigger } from "@radix-ui/react-collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "./ui/card";
import { Avatar } from "@radix-ui/react-avatar";
import { AvatarFallback, AvatarImage } from "./ui/avatar";
import { Separator } from "./ui/separator";

export default function ScenarioOverview({ scenario }: { scenario: Scenario }) {
  const [isCompanyCultureOpen, setIsCompanyCultureOpen] = useState(true);

  return (
    <div className="flex flex-col p-5 w-1/4 gap-2 overflow-y-scroll border-r">
      <h1 className="text-2xl font-bold">Scenario</h1>
      <div className="flex flex-col">
        {scenario.situation.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>

      <Separator />

      <Collapsible
        open={isCompanyCultureOpen}
        onOpenChange={setIsCompanyCultureOpen}
        className="flex flex-col"
      >
        <CollapsibleTrigger className="cursor-pointer">
          <div className="flex w-full justify-between">
            <h2 className="text-lg font-bold">Company Overview</h2>
            {isCompanyCultureOpen ? <ChevronDown /> : <ChevronUp />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div>
            {scenario.companyDetails.split("\n").map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      <h2 className="text-lg font-bold">Coworkers</h2>
      {scenario.npcs.length === 0 ? (
        <p>No coworkers in this scenario.</p>
      ) : (
        scenario.npcs.map((npc, index) => <NpcOverview key={index} npc={npc} />)
      )}

      <Separator className="mt-2" />

      <h2 className="text-lg font-bold">Documents</h2>
      {scenario.documents.length === 0 ? (
        <p>No documents in this scenario.</p>
      ) : (
        scenario.documents.map((doc, index) => (
          <DocumentOverview key={index} doc={doc} />
        ))
      )}
    </div>
  );
}

function NpcOverview({ npc }: { npc: Npc }) {
  const [isOpen, setIsOpen] = useState(false);

  const title = npc.role.includes(".") ? npc.role.split(".")[0] : npc.role;

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
              <Avatar className="max-lg:hidden rounded-full w-8 h-8">
                <AvatarImage src={npc.pfp} className="rounded-full" />
                <AvatarFallback>{npc.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start">
                <h3 className="font-bold">{npc.name}</h3>
                <p className="text-sm text-left">{title}</p>
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

function DocumentOverview({ doc }: { doc: ScenarioDocument }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card>
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="flex flex-col"
      >
        <CollapsibleTrigger className="cursor-pointer">
          <div className="flex w-full justify-between px-4 py-1">
            <h3 className="font-bold text-left">{doc.title}</h3>
            <div className="flex">
              <p>({doc.type})</p>
              {isOpen ? <ChevronDown /> : <ChevronUp />}
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="p-4 pt-0">
          {doc.content.map((block, index) => (
            <DocumentContentBlock key={index} block={block} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function DocumentContentBlock({ block }: { block: ScenarioDocumentBlock }) {
  let className = "";
  if (block.format === "bold") className = "font-bold";
  else if (block.format === "italic") className = "italic";
  else if (block.format === "code")
    className = "font-mono bg-gray-100 p-1 rounded";

  const lines = block.content.split("\n");

  return (
    <div className={className}>
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}
