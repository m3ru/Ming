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
  Paperclip,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

const summaryClassName =
  "flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 text-sm font-bold text-ink transition-colors hover:text-pencil [&::-webkit-details-marker]:hidden";
const chevronClassName =
  "size-4 shrink-0 text-ink-soft transition-transform duration-200 ease-out";

export default function ScenarioOverview({ scenario }: { scenario: Scenario }) {
  return (
    <aside
      key={scenario.title}
      aria-label="Scenario brief"
      className="rise flex flex-col gap-5 overflow-y-auto rounded-xl border border-rule bg-white p-5 lg:min-h-0"
    >
      <header className="space-y-4">
        <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-ink">
          {scenario.title}
        </h1>
        <div className="space-y-1.5">
          <h2 className="text-sm font-bold text-ink">
            <span className="marker">Your goal</span>
          </h2>
          <p className="text-sm leading-relaxed text-ink">{scenario.goal}</p>
        </div>
      </header>

      {scenario.npcs.length > 0 && (
        <section aria-label="Cast" className="border-t border-rule pt-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
            <Users aria-hidden="true" className="size-4 text-ink-soft" />
            Cast
          </h2>
          {scenario.npcs.map((npc, index) => (
            <NpcOverview key={`${npc.name}-${index}`} npc={npc} />
          ))}
        </section>
      )}

      <div className="divide-y divide-rule border-t border-rule">
        <details className="smooth-details group/background">
          <summary className={summaryClassName}>
            <span className="flex items-center gap-2">
              <ScrollText aria-hidden="true" className="size-4 text-ink-soft" />
              Background
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`${chevronClassName} group-open/background:rotate-180`}
            />
          </summary>
          <div className="space-y-4 pb-4 text-sm leading-relaxed text-ink-soft">
            <p className="whitespace-pre-line">{scenario.situation}</p>
            {scenario.companyDetails && (
              <div className="space-y-1">
                <h2 className="font-semibold text-ink">Company</h2>
                <p className="whitespace-pre-line">{scenario.companyDetails}</p>
              </div>
            )}
          </div>
        </details>

        {scenario.documents.length > 0 && (
          <details open className="smooth-details group/documents">
            <summary className={summaryClassName}>
              <span className="flex items-center gap-2">
                <Paperclip aria-hidden="true" className="size-4 text-ink-soft" />
                Documents
                <span className="text-xs font-normal text-ink-soft">
                  {scenario.documents.length}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`${chevronClassName} group-open/documents:rotate-180`}
              />
            </summary>
            <div className="space-y-1 pb-1">
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
    <details className="smooth-details group/person">
      <summary className={`${summaryClassName} font-normal`}>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar className="size-12 shrink-0 rounded-lg">
            <AvatarImage src={npc.pfp} alt="" className="object-cover" />
            <AvatarFallback className="rounded-lg">
              {npc.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block text-base font-bold text-ink">
              {npc.name}
            </span>
            <span className="mt-0.5 block text-sm leading-snug text-ink-soft">
              {title}
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`${chevronClassName} group-open/person:rotate-180`}
        />
      </summary>
      <div className="space-y-3 pb-1 text-sm leading-relaxed text-ink-soft">
        <p className="whitespace-pre-line">{npc.scenarioSpecificInfo}</p>
        <p className="whitespace-pre-line">{npc.personality}</p>
      </div>
    </details>
  );
}

// Coloured per document type, so the stack of documents scans at a glance.
const documentIcons: Record<string, { Icon: LucideIcon; tone: string }> = {
  performance_report: { Icon: ChartColumn, tone: "bg-pencil/10 text-pencil" },
  incident_report: { Icon: Bug, tone: "bg-red-pencil/10 text-red-pencil" },
  project_report: { Icon: CalendarDays, tone: "bg-sage/10 text-sage" },
};
const defaultDocumentIcon = { Icon: FileText, tone: "bg-muted text-ink-soft" };

function DocumentOverview({ doc }: { doc: ScenarioDocument }) {
  const { Icon, tone } = documentIcons[doc.type] ?? defaultDocumentIcon;

  return (
    <details className="smooth-details group/document">
      <summary
        className={`${summaryClassName} items-start gap-2.5 px-2 py-2 font-normal hover:bg-paper hover:text-ink`}
      >
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-md ${tone}`}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1 self-center leading-snug">
          {doc.title}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`${chevronClassName} mt-1.5 group-open/document:rotate-180`}
        />
      </summary>
      <div className="space-y-3 px-2 pb-4 pt-2 text-sm leading-relaxed text-ink-soft">
        {doc.content.map((block, index) => (
          <DocumentContentBlock key={index} block={block} />
        ))}
      </div>
    </details>
  );
}

function DocumentContentBlock({ block }: { block: ScenarioDocumentBlock }) {
  let className = "whitespace-pre-line";
  if (block.format === "bold") className += " font-semibold text-ink";
  else if (block.format === "italic") className += " italic";
  else if (block.format === "code")
    className += " break-words rounded-lg bg-paper p-2 font-mono text-xs";

  return <p className={className}>{block.content}</p>;
}
