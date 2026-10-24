"use client";

import type {
  Npc,
  Scenario,
  ScenarioDocument,
  ScenarioDocumentBlock,
} from "@/lib/types";
import {
  Bug,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

const summaryClassName =
  "flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-3 text-sm font-medium text-slate-700 outline-none hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden";

export default function ScenarioOverview({ scenario }: { scenario: Scenario }) {
  return (
    <aside
      key={scenario.title}
      aria-label="Scenario brief"
      className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-slate-50/60 px-5 py-6 lg:w-72"
    >
      <header className="space-y-5">
        <h1 className="text-lg font-semibold leading-snug text-slate-950">
          {scenario.title}
        </h1>
        <div className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Your goal
          </h2>
          <p className="text-sm leading-relaxed text-slate-700">
            {scenario.goal}
          </p>
        </div>
      </header>

      {scenario.npcs.length > 0 && (
        <section aria-label="People" className="space-y-1 border-t pt-3">
          {scenario.npcs.map((npc, index) => (
            <NpcOverview key={`${npc.name}-${index}`} npc={npc} />
          ))}
        </section>
      )}

      <div className="divide-y border-t">
        <details className="group/background">
          <summary className={summaryClassName}>
            Background
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-slate-400 transition-transform group-open/background:rotate-180"
            />
          </summary>
          <div className="space-y-4 pb-4 text-sm leading-relaxed text-slate-600">
            <p className="whitespace-pre-line">{scenario.situation}</p>
            {scenario.companyDetails && (
              <div className="space-y-1">
                <h2 className="text-xs font-medium text-slate-500">Company</h2>
                <p className="whitespace-pre-line">{scenario.companyDetails}</p>
              </div>
            )}
          </div>
        </details>

        {scenario.documents.length > 0 && (
          <details open className="group/documents">
            <summary className={summaryClassName}>
              <span className="flex items-center gap-2">
                Documents
                <span className="text-xs font-normal text-slate-400">
                  {scenario.documents.length}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 text-slate-400 transition-transform group-open/documents:rotate-180"
              />
            </summary>
            <div className="space-y-1 pb-3">
              {scenario.documents.map((doc, index) => (
                <DocumentOverview key={`${doc.title}-${index}`} doc={doc} />
              ))}
            </div>
          </details>
        )}
      </div>
    </aside>
  );
}

function NpcOverview({ npc }: { npc: Npc }) {
  const title = npc.role.split(".")[0];

  return (
    <details className="group/person">
      <summary className={`${summaryClassName} py-2`}>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarImage src={npc.pfp} alt="" />
            <AvatarFallback>{npc.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-900">
              {npc.name}
            </span>
            <span className="mt-0.5 block text-xs font-normal leading-relaxed text-slate-500">
              {title}
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-slate-400 transition-transform group-open/person:rotate-180"
        />
      </summary>
      <div className="space-y-3 py-3 text-sm leading-relaxed text-slate-600">
        <p className="whitespace-pre-line">{npc.scenarioSpecificInfo}</p>
        <p className="whitespace-pre-line">{npc.personality}</p>
      </div>
    </details>
  );
}

const documentIcons: Record<string, LucideIcon> = {
  performance_report: ChartColumn,
  incident_report: Bug,
  project_report: CalendarDays,
};

function DocumentOverview({ doc }: { doc: ScenarioDocument }) {
  const Icon = documentIcons[doc.type] ?? FileText;

  return (
    <details className="group/document">
      <summary
        className={`${summaryClassName} items-start gap-2 px-2 py-2 text-xs font-normal hover:bg-slate-100`}
      >
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-slate-400"
        />
        <span className="min-w-0 flex-1 leading-relaxed">{doc.title}</span>
        <ChevronDown
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-slate-400 transition-transform group-open/document:rotate-180"
        />
      </summary>
      <div className="space-y-3 px-2 pb-4 pt-2 text-xs leading-relaxed text-slate-600">
        {doc.content.map((block, index) => (
          <DocumentContentBlock key={index} block={block} />
        ))}
      </div>
    </details>
  );
}

function DocumentContentBlock({ block }: { block: ScenarioDocumentBlock }) {
  let className = "whitespace-pre-line";
  if (block.format === "bold") className += " font-medium text-slate-800";
  else if (block.format === "italic") className += " italic";
  else if (block.format === "code")
    className += " break-words rounded bg-slate-100 p-2 font-mono";

  return <p className={className}>{block.content}</p>;
}
