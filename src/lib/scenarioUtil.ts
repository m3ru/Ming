import { ScenarioDocument } from "./types";

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
