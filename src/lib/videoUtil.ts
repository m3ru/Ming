import "server-only";

import type { Scenario } from "./types";
import { GoogleGenAI } from "@google/genai";

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
  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Video generation requires GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_API_KEY.",
    );
  }
  const ai = new GoogleGenAI({ apiKey });
  let operation = await ai.models.generateVideos({
    model: "veo-3.0-fast-generate-001",
    prompt,
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("Video generation completed without a video.");
  await ai.files.download({
    file: video,
    downloadPath: "./video.mp4",
  });
  console.log("Video downloaded to ./video.mp4");
}
