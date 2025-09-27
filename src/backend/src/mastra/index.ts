import { Mastra } from '@mastra/core/mastra';
import { chatWorkflow } from './workflows/chatWorkflow';
import { feedbackOrchestratorWorkflow } from './workflows/feedbackOrchestratorWorkflow';
import { scenarioPipelineWorkflow } from './workflows/scenarioPipelineWorkflow';
import { apiRoutes } from './apiRegistry';
import { helloWorldAgent } from './agents/helloWorldAgent';
import { storage } from './memory';
import { billAgent } from './agents/billAgent';
import { workingMemoryAgent } from './agents/workingMemoryAgent';
import { transcriptSummaryAnalyzerAgent } from './agents/transcriptSummaryAnalyzerAgent';
import { transcriptAnalyzerAgent } from './agents/transcriptAnalyzerAgent';
import { transcriptDetailAgent } from './agents/transcriptDetailAgent';
import { scenarioCreateAgent } from './agents/scenarioCreateAgent';
import { promptCreateAgent } from './agents/promptCreateAgent';
import { reportCreateAgent } from './agents/reportCreateAgent';

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
    billAgent,
    workingMemoryAgent,
    transcriptSummaryAnalyzerAgent,
    transcriptAnalyzerAgent,
    transcriptDetailAgent,
    scenarioCreateAgent,
    promptCreateAgent,
    reportCreateAgent
  },
  workflows: { chatWorkflow, feedbackOrchestratorWorkflow, scenarioPipelineWorkflow },
  storage,
  telemetry: {
    enabled: true,
  },
  observability: {
	default: {
		enabled: true,
	}
  },
  server: {
    apiRoutes,
  },
});
