import "dotenv/config";
 
import { mastra } from "./mastra";
import { transcript } from "./lib/placeholder-data";

const agent = mastra.getAgent("transcriptSummaryAnalyzerAgent");

const response = await agent.generateVNext(transcript);

console.log(response.text);
