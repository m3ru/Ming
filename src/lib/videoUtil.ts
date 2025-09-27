import { Scenario } from "./types";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_AI_STUDIO_KEY!,
});

export default async function generateScenarioVideo(scenario: Scenario) {
  const prompt = scenarioToPrompt(scenario);
  await generateVideo(prompt);
}

function scenarioToPrompt(scenario: Scenario): string {
  let prompt = `Generate a loopable video based on the following scenario:\n\n`;
  prompt += `Title: ${scenario.title}\n\n`;
  prompt += `Situation: ${scenario.situation}\n\n`;
  prompt += `Company Culture: ${scenario.companyDetails}\n\n`;
  prompt += `NPCs:\n`;
  scenario.npcs.forEach((npc) => {
    prompt += `- ${npc.name} (${npc.role}): ${npc.scenarioSpecificInfo}\n`;
  });
  prompt += `Documents:\n`;
  scenario.documents.forEach((doc) => {
    prompt += `- ${doc.title} (${doc.type}): ${doc.content.map((block) => block.content).join(" ")}`;
  });
  return prompt;
}

async function generateVideo(prompt: string) {
  let operation = await ai.models.generateVideos({
    model: "veo-3.0-fast-generate-001",
    prompt,
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  ai.files.download({
    file: operation.response?.generatedVideos?.[0]?.video!,
    downloadPath: "./video.mp4",
  });
  console.log("Video downloaded to ./video.mp4");
}
