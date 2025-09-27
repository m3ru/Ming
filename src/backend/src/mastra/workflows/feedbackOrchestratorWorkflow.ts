import { createWorkflow, createStep } from '@mastra/core/workflows';
import { RuntimeContext } from '@mastra/core/di';
import { z } from 'zod';
import { transcriptAnalyzerAgent } from '../agents/transcriptAnalyzerAgent';
import { transcriptSummaryAnalyzerAgent } from '../agents/transcriptSummaryAnalyzerAgent';
import { transcriptDetailAgent } from '../agents/transcriptDetailAgent';

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
  execute: async ({ inputData, runtimeContext }) => {
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
      segmentedAnalysis: result.text,
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
  execute: async ({ inputData }) => {
    const { transcript, additionalContext, resourceId, threadId, segmentedAnalysis } = inputData;

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    const messages = [
      'Analyze this workplace conversation transcript for overall summary: ' + transcript,
      'Additional context: ' + JSON.stringify(additionalContext),
    ];

    const result = await transcriptSummaryAnalyzerAgent.generateVNext(messages, {
      runtimeContext: agentRuntimeContext,
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
      summaryAnalysis: result.text,
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
  execute: async ({ inputData, runtimeContext }) => {
    const { segmentedAnalysis, summaryAnalysis } = inputData;

    const additionalContext = runtimeContext?.get('additionalContext');
    const resourceId = runtimeContext?.get('resourceId');
    const threadId = runtimeContext?.get('threadId');

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    // Extract segments from segmented analysis
    const segments = [];
    const segmentRegex = /<segment:([^>]+)>\s*([\s\S]*?)\s*<\/segment:[^>]+>/g;
    let match;

    while ((match = segmentRegex.exec(segmentedAnalysis)) !== null) {
      segments.push({
        title: match[1],
        content: match[2].trim(),
      });
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
      ...(threadId && resourceId
        ? {
            memory: {
              thread: threadId + '_detail',
              resource: resourceId as string,
            },
          }
        : {}),
    });

    return {
      segmentedAnalysis,
      summaryAnalysis,
      detailedFeedback: result.text,
    };
  },
});

const combineResults = createStep({
  id: 'combineResults',
  description: 'Combine all analysis results into a comprehensive feedback report',
  inputSchema: z.object({
    segmentedAnalysis: z.string(),
    summaryAnalysis: z.string(),
    detailedFeedback: z.string(),
  }),
  outputSchema: FeedbackOrchestratorOutputSchema,
  execute: async ({ inputData }) => {
    const { segmentedAnalysis, summaryAnalysis, detailedFeedback } = inputData;

    const combinedReport = `
# Comprehensive Conversation Feedback Report

## Executive Summary
${summaryAnalysis}

---

## Detailed Psychological & Segmented Analysis
${segmentedAnalysis}

---

## Phrase-Level Communication Feedback
${detailedFeedback}

---

*This comprehensive feedback report was generated by analyzing your workplace conversation through multiple specialized AI agents focused on different aspects of communication effectiveness.*
    `.trim();

    return {
      segmentedAnalysis,
      summaryAnalysis,
      detailedFeedback,
      combinedReport,
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
//   .then(combineResults)
  .commit();