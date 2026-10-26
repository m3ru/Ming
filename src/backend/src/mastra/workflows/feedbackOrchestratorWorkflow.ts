/* eslint-disable @typescript-eslint/no-explicit-any */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { RuntimeContext } from '@mastra/core/di';
import { z } from 'zod';
import { transcriptAnalyzerAgent } from '../agents/transcriptAnalyzerAgent';
import { transcriptSummaryAnalyzerAgent } from '../agents/transcriptSummaryAnalyzerAgent';
import { transcriptDetailAgent } from '../agents/transcriptDetailAgent';
import { resolveTextProvider } from '../../lib/providers';

function reportGenerationOptions(maxOutputTokens: number, temperature?: number) {
  const { provider, model } = resolveTextProvider();
  return {
    modelSettings: {
      // Reasoning tokens count against this budget (Gemini thinking; GPT-6 Luna's medium effort).
      maxOutputTokens: provider === 'gemini' ? 4096 : maxOutputTokens + 4096,
      ...(temperature === undefined ? {} : { temperature }),
    },
    ...(provider === 'gemini' && /^gemini-3(?:\.\d+)?-/.test(model)
      ? { providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } } }
      : {}),
  };
}

function completeReportText(result: { text: string; finishReason?: string }) {
  if (result.finishReason === 'length') {
    throw new Error('Report generation reached its output limit. Try generating the report again.');
  }
  return result.text;
}

export const FeedbackOrchestratorInputSchema = z.object({
  transcript: z.string(),
  additionalContext: z.any().optional(),
  resourceId: z.string().optional(),
  threadId: z.string().optional(),
});

export const FeedbackOrchestratorOutputSchema = z.object({
  segmentedAnalysis: z.string(),
  summaryAnalysis: z.string(),
  detailedFeedback: z.string(),
  combinedReport: z.string(),
});

export type FeedbackOrchestratorOutput = z.infer<typeof FeedbackOrchestratorOutputSchema>;

const analyzeTranscript = createStep({
  id: 'analyzeTranscript',
  description: 'Analyze transcript with transcriptAnalyzerAgent to get segments and psychological analysis',
  inputSchema: FeedbackOrchestratorInputSchema,
  outputSchema: z.object({
    segmentedAnalysis: z.string(),
    transcript: z.string(),
    additionalContext: z.any().optional(),
    resourceId: z.string().optional(),
    threadId: z.string().optional(),
  }),
  execute: async ({ inputData, runtimeContext, abortSignal }) => {
    const { transcript, additionalContext, resourceId, threadId } = inputData;

    // Store context in runtime for downstream steps
    runtimeContext?.set('additionalContext', additionalContext);
    runtimeContext?.set('resourceId', resourceId);
    runtimeContext?.set('threadId', threadId);

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    const messages = [
      'Analyze this workplace conversation transcript: ' + transcript,
      'Additional context: ' + JSON.stringify(additionalContext),
    ];

    const result = await transcriptAnalyzerAgent.generateVNext(messages, {
      runtimeContext: agentRuntimeContext,
      abortSignal,
      ...reportGenerationOptions(4096),
      ...(threadId && resourceId
        ? {
            memory: {
              thread: threadId + '_analyzer',
              resource: resourceId as string,
            },
          }
        : {}),
    });

    return {
      segmentedAnalysis: completeReportText(result),
      transcript,
      additionalContext,
      resourceId,
      threadId,
    };
  },
});

const generateSummary = createStep({
  id: 'generateSummary',
  description: 'Generate overall summary analysis using transcriptSummaryAnalyzerAgent',
  inputSchema: z.object({
    segmentedAnalysis: z.string(),
    transcript: z.string(),
    additionalContext: z.any().optional(),
    resourceId: z.string().optional(),
    threadId: z.string().optional(),
  }),
  outputSchema: z.object({
    segmentedAnalysis: z.string(),
    summaryAnalysis: z.string(),
  }),
  execute: async ({ inputData, abortSignal }) => {
    const { transcript, additionalContext, resourceId, threadId, segmentedAnalysis } = inputData;

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    const messages = [
      'Analyze this workplace conversation transcript for overall summary: ' + transcript,
      'Additional context: ' + JSON.stringify(additionalContext),
    ];

    const result = await transcriptSummaryAnalyzerAgent.generateVNext(messages, {
      runtimeContext: agentRuntimeContext,
      abortSignal,
      ...reportGenerationOptions(2048),
      ...(threadId && resourceId
        ? {
            memory: {
              thread: threadId + '_summary',
              resource: resourceId as string,
            },
          }
        : {}),
    });

    return {
      segmentedAnalysis,
      summaryAnalysis: completeReportText(result),
    };
  },
});

const analyzeDetails = createStep({
  id: 'analyzeDetails',
  description: 'Analyze detailed phrase-level feedback using transcriptDetailAgent',
  inputSchema: z.object({
    segmentedAnalysis: z.string(),
    summaryAnalysis: z.string(),
  }),
  outputSchema: z.object({
    segmentedAnalysis: z.string(),
    summaryAnalysis: z.string(),
    detailedFeedback: z.string(),
  }),
  execute: async ({ inputData, runtimeContext, abortSignal }) => {
    const { segmentedAnalysis, summaryAnalysis } = inputData;

    const additionalContext = runtimeContext?.get('additionalContext');
    const resourceId = runtimeContext?.get('resourceId');
    const threadId = runtimeContext?.get('threadId');

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    // Extract segments from segmented analysis. Keep this pattern identical to the browser's
    // (src/app/report/parser.tsx), so both sides find the same segments.
    const segments = [];
    const segmentRegex = /<segment:\s*([^>]+?)\s*>([\s\S]*?)<\/segment:[^>]*>/gi;
    let match;

    while ((match = segmentRegex.exec(segmentedAnalysis)) !== null) {
      segments.push({
        title: match[1],
        content: match[2].trim(),
      });
    }
    // With nothing to anchor them, the detail agent's phrase notes would be invented.
    if (!segments.length) {
      throw new Error('The transcript analysis returned no segments. Try generating the report again.');
    }

    // Prepare segments for detailed analysis
    const segmentText = segments.map(segment =>
      `Segment: ${segment.title}\n${segment.content}`
    ).join('\n\n');

    const messages = [
      'Provide detailed phrase-level feedback for these conversation segments: ' + segmentText,
      'Additional context: ' + JSON.stringify(additionalContext),
    ];

    const result = await transcriptDetailAgent.generateVNext(messages, {
      runtimeContext: agentRuntimeContext,
      abortSignal,
      ...reportGenerationOptions(4096, 0.2),
      ...(threadId && resourceId
        ? {
            memory: {
              thread: threadId + '_detail',
              resource: resourceId as string,
            },
          }
        : {}),
    } as any);

    return {
      segmentedAnalysis,
      summaryAnalysis,
      detailedFeedback: completeReportText(result),
    };
  },
});

export const feedbackOrchestratorWorkflow = createWorkflow({
  id: 'feedbackOrchestratorWorkflow',
  description: 'Orchestrates multiple agents to provide comprehensive feedback on workplace conversation transcripts',
  inputSchema: FeedbackOrchestratorInputSchema,
  outputSchema: FeedbackOrchestratorOutputSchema,
})
  .then(analyzeTranscript)
  .then(generateSummary)
  .then(analyzeDetails)
  .commit();
