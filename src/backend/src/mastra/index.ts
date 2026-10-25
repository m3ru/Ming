import { Mastra } from "@mastra/core/mastra";
import { chatWorkflow } from "./workflows/chatWorkflow";
import { feedbackOrchestratorWorkflow } from "./workflows/feedbackOrchestratorWorkflow";
import { scenarioPipelineWorkflow } from "./workflows/scenarioPipelineWorkflow";
import { apiRoutes } from "./apiRegistry";
import { helloWorldAgent } from "./agents/helloWorldAgent";
import { storage } from "./memory";
import { defaultAgent } from "./agents/defaultAgent";
import { workingMemoryAgent } from "./agents/workingMemoryAgent";
import { transcriptSummaryAnalyzerAgent } from "./agents/transcriptSummaryAnalyzerAgent";
import { transcriptAnalyzerAgent } from "./agents/transcriptAnalyzerAgent";
import { transcriptDetailAgent } from "./agents/transcriptDetailAgent";
import { scenarioCreateAgent } from "./agents/scenarioCreateAgent";
import { promptCreateAgent } from "./agents/promptCreateAgent";
import { reportCreateAgent } from "./agents/reportCreateAgent";
import { feedbackReplyAgent } from "./agents/feedbackReplyAgent";
import { gatewayBoundary, DEEPGRAM_REQUEST_BYTE_LIMIT } from "../lib/security";

/**
 * Main Mastra configuration
 *
 * This is where you configure your agents, workflows, storage, and other settings.
 * The starter template includes:
 * - A basic agent that can be customized
 * - A chat workflow for handling conversations
 * - In-memory storage (replace with your preferred database)
 * - API routes for the frontend to communicate with
 */

export const mastra = new Mastra({
  agents: {
    helloWorldAgent,
    defaultAgent,
    workingMemoryAgent,
    transcriptSummaryAnalyzerAgent,
    transcriptAnalyzerAgent,
    transcriptDetailAgent,
    scenarioCreateAgent,
    promptCreateAgent,
    reportCreateAgent,
    feedbackReplyAgent,
  },
  workflows: {
    chatWorkflow,
    feedbackOrchestratorWorkflow,
    scenarioPipelineWorkflow,
  },
  storage,
  // Mastra 0.18 tracing deep-cleans stream results by reading their promise
  // getters. On provider failure this creates detached rejections that can
  // terminate Node 26 even when the workflow catches the original error.
  // Keep tracing disabled until an upgrade passes backend-streaming.test.mjs;
  // application errors are still returned through the explicit SSE contract.
  telemetry: {
    enabled: false,
  },
  observability: {
    default: {
      enabled: false,
    },
  },
  server: {
    apiRoutes,
    middleware: gatewayBoundary,
    cors: false,
    // The gateway middleware retains 256 KiB for every other route.
    bodySizeLimit: DEEPGRAM_REQUEST_BYTE_LIMIT,
  },
});
