import { Scenario, ScenarioDocument } from "./types";

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
  context += `Description: ${scenario.descriptionForAnalyzer}\n\n`;
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
