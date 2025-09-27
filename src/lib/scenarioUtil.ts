import { Scenarios } from "@/backend/src/lib/scenarios";
import { Npc, Scenario, ScenarioDocument } from "./types";

export function documentToString(doc: ScenarioDocument): string {
  let result = "";

  result += `Title: ${doc.title}\n`;
  result += `Type: ${doc.type}\n`;
  result += "Content:\n";

  for (const block of doc.content) {
    if (block.format === "bold") {
      result += `**${block.content}**`;
    } else if (block.format === "italic") {
      result += `*${block.content}*`;
    } else if (block.format === "code") {
      result += `\`\`\`\n${block.content}\n\`\`\``;
    } else {
      result += `${block.content}`;
    }

    result += "\n";
  }

  return result;
}

export function contextForAnalysis(scenario: Scenario): string {
  let context = "";

  context += `Scenario Title: ${scenario.title}\n`;
  context += `Goal: ${scenario.goalForAnalyzer}\n\n`;
  context += `Situation: ${scenario.situationForAnalyzer}\n\n`;
  context += `Company Details: ${scenario.companyDetails}\n\n`;
  context += `User: ${scenario.userRole}\n\n`;

  context += `NPCs:\n`;
  for (const npc of scenario.npcs) {
    context += `- Name: ${npc.name}\n`;
    context += `  Role: ${npc.role}\n`;
    context += `  Personality: ${npc.personality}\n`;
    context += `  Scenario Specific Info: ${npc.scenarioSpecificInfo}\n\n`;
  }

  context += `Documents:\n`;
  for (const doc of scenario.documents) {
    context += documentToString(doc) + "\n";
  }

  return context;
}

export function parseScenario(
  scenarioCreateAgentOutput: string,
  promptCreateAgentOutput: string,
  reportCreateAgentOutput: string
): Scenario {
  if (typeof DOMParser === "undefined") {
    return {} as any;
  }

  const overviewDom = new DOMParser().parseFromString(
    formatXml(scenarioCreateAgentOutput),
    "text/xml"
  );

  const npcDom = new DOMParser().parseFromString(
    formatXml(promptCreateAgentOutput),
    "text/xml"
  );

  const docDom = new DOMParser().parseFromString(
    formatXml(reportCreateAgentOutput),
    "text/xml"
  );

  const scenario: Scenario = {} as any;

  scenario.title = getString(overviewDom, "scenario_title");
  scenario.goal = getString(overviewDom, "scenario_goal");
  scenario.situation = getString(overviewDom, "situation");
  scenario.companyDetails = getString(overviewDom, "company_details");
  scenario.userRole = getString(overviewDom, "role_user");

  scenario.npcs = [parseNpc(npcDom, overviewDom)];

  scenario.documents = [];

  const docRoot = docDom.getElementsByTagName("root")[0];

  console.log("Found document root:", docRoot);
  for (let i = 0; i < docRoot.children.length; i++) {
    const element = docRoot.children[i];
    const doc = parseDocument(element);
    if (doc) {
      scenario.documents.push(doc);
    }
  }

  return scenario;
}

function formatXml(xml: string): string {
  return `<root>${xml}</root>`
    .replace("&", "&amp;")
    .replace('"', "&quot;")
    .replace("“", "&quot;")
    .replace("”", "&quot;")
    .replace("'", "&apos;")
    .replace("’", "&apos;");
}

function getString(doc: Document, selector: string): string {
  const selected = doc.querySelector(selector);
  const result = selected ? selected.textContent : "Unknown";

  console.log(
    `Extracted ${selector}:`,
    result,
    "from",
    selected,
    "in doc",
    doc
  );
  return result.trim();
}

function parseNpc(npcDoc: Document, scenarioDoc: Document): Npc {
  const npc: Npc = {} as any;

  npc.name = "Bill";
  npc.pfp = Scenarios.demandingClient.npcs[0].pfp;
  npc.role = getString(scenarioDoc, "role");
  npc.scenarioSpecificInfo = getString(scenarioDoc, "scenario_specific_info");
  npc.personality = getString(npcDoc, "personality_llm");

  return npc;
}

function parseDocument(element: Element): ScenarioDocument | undefined {
  console.log("Parsing document element:", element);

  const doc: ScenarioDocument = {} as any;

  const text = element.textContent || "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length === 0) {
    console.warn("Empty document element, skipping.", element);
    return;
  }

  doc.title = lines[0];

  if (doc.title.toLowerCase().includes("error")) {
    console.warn("Document title indicates an error (skipping):", doc.title);
    return;
  }

  doc.type = "other";
  if (doc.title.toLowerCase().includes("email")) {
    doc.type = "email";
  } else if (doc.title.toLowerCase().includes("chat")) {
    doc.type = "chat";
  } else if (doc.title.toLowerCase().includes("report")) {
    doc.type = "report";
  } else if (doc.title.toLowerCase().includes("ticket")) {
    doc.type = "ticket";
  } else if (doc.title.toLowerCase().includes("timeline")) {
    doc.type = "timeline";
  }

  doc.content = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("**") && line.endsWith("**")) {
      doc.content.push({
        format: "bold",
        content: line.slice(2, -2).trim(),
      });
    } else if (line.startsWith("*") && line.endsWith("*")) {
      doc.content.push({
        format: "italic",
        content: line.slice(1, -1).trim(),
      });
    } else if (line.startsWith("```") && line.endsWith("```")) {
      doc.content.push({
        format: "code",
        content: line.slice(3, -3).trim(),
      });
    } else {
      doc.content.push({
        format: "plain",
        content: line,
      });
    }
  }

  return doc;
}
