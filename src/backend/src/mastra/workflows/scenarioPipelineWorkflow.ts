import { createWorkflow, createStep } from '@mastra/core/workflows';
import { RuntimeContext } from '@mastra/core/di';
import { z } from 'zod';
import { scenarioCreateAgent } from '../agents/scenarioCreateAgent';
import { promptCreateAgent } from '../agents/promptCreateAgent';
import { reportCreateAgent } from '../agents/reportCreateAgent';

export const ScenarioPipelineInputSchema = z.object({
  analysis: z.string().describe('Analysis from transcript analysis containing strengths, weaknesses, and psychological profile'),
  additionalContext: z.any().optional(),
  resourceId: z.string().optional(),
  threadId: z.string().optional(),
});

export const ScenarioPipelineOutputSchema = z.object({
  scenario: z.string().describe('Generated scenario with structured XML output'),
  prompts: z.string().describe('Generated prompts for Bart character'),
  reports: z.string().describe('Generated supporting documents'),
  combinedPackage: z.string().describe('Complete scenario package for training'),
});

export type ScenarioPipelineOutput = z.infer<typeof ScenarioPipelineOutputSchema>;

const createScenario = createStep({
  id: 'createScenario',
  description: 'Generate a conflict management scenario with Bart based on user analysis',
  inputSchema: ScenarioPipelineInputSchema,
  outputSchema: z.object({
    scenario: z.string(),
    analysis: z.string(),
    additionalContext: z.any().optional(),
    resourceId: z.string().optional(),
    threadId: z.string().optional(),
  }),
  execute: async ({ inputData, runtimeContext }) => {
    const { analysis, additionalContext, resourceId, threadId } = inputData;

    // Store context in runtime for downstream steps
    runtimeContext?.set('additionalContext', additionalContext);
    runtimeContext?.set('resourceId', resourceId);
    runtimeContext?.set('threadId', threadId);

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    const messages = [
      'Create a workplace conflict scenario with Bart based on this user analysis: ' + analysis,
      'Additional context: ' + JSON.stringify(additionalContext),
    ];

    const result = await scenarioCreateAgent.generateVNext(messages, {
      runtimeContext: agentRuntimeContext,
	  modelSettings: {
		temperature: 0.2,
	  },
      ...(threadId && resourceId
        ? {
            memory: {
              thread: threadId + '_scenario',
              resource: resourceId as string,
            },
          }
        : {}),
    });

    return {
      scenario: result.text,
      analysis,
      additionalContext,
      resourceId,
      threadId,
    };
  },
});

const createPrompts = createStep({
  id: 'createPrompts',
  description: 'Generate LLM prompts for Bart character based on scenario and analysis',
  inputSchema: z.object({
    scenario: z.string(),
    analysis: z.string(),
    additionalContext: z.any().optional(),
    resourceId: z.string().optional(),
    threadId: z.string().optional(),
  }),
  outputSchema: z.object({
    scenario: z.string(),
    prompts: z.string(),
    analysis: z.string(),
  }),
  execute: async ({ inputData, runtimeContext }) => {
    const { scenario, analysis, additionalContext, resourceId, threadId } = inputData;

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    const messages = [
      'Create LLM prompts for Bart character based on this scenario and user analysis:',
      'SCENARIO: ' + scenario,
      'USER ANALYSIS: ' + analysis,
      'Additional context: ' + JSON.stringify(additionalContext),
    ];

    const result = await promptCreateAgent.generateVNext(messages, {
      runtimeContext: agentRuntimeContext,
      modelSettings: {
		temperature: 0.2,
	  },
      ...(threadId && resourceId
        ? {
            memory: {
              thread: threadId + '_prompts',
              resource: resourceId as string,
            },
          }
        : {}),
    });

    return {
      scenario,
      prompts: result.text,
      analysis,
    };
  },
});

const createReports = createStep({
  id: 'createReports',
  description: 'Generate supporting documents for the scenario',
  inputSchema: z.object({
    scenario: z.string(),
    prompts: z.string(),
    analysis: z.string(),
  }),
  outputSchema: z.object({
    scenario: z.string(),
    prompts: z.string(),
    reports: z.string(),
  }),
  execute: async ({ inputData, runtimeContext }) => {
    const { scenario, prompts, analysis } = inputData;

    const additionalContext = runtimeContext?.get('additionalContext');
    const resourceId = runtimeContext?.get('resourceId');
    const threadId = runtimeContext?.get('threadId');

    const agentRuntimeContext = new RuntimeContext();
    agentRuntimeContext.set('additionalContext', additionalContext);

    const messages = [
      'Create 3-4 supporting documents for this workplace scenario:',
      'SCENARIO: ' + scenario,
      'BART PROMPTS: ' + prompts,
      'USER ANALYSIS: ' + analysis,
      'Additional context: ' + JSON.stringify(additionalContext),
    ];

    const result = await reportCreateAgent.generateVNext(messages, {
      runtimeContext: agentRuntimeContext,
      modelSettings: {
        temperature: 0.2,
      },
      ...(threadId && resourceId
        ? {
            memory: {
              thread: threadId + '_reports',
              resource: resourceId as string,
            },
          }
        : {}),
    });

    return {
      scenario,
      prompts,
      reports: result.text,
    };
  },
});

const combinePackage = createStep({
  id: 'combinePackage',
  description: 'Combine all generated content into a comprehensive scenario package',
  inputSchema: z.object({
    scenario: z.string(),
    prompts: z.string(),
    reports: z.string(),
  }),
  outputSchema: ScenarioPipelineOutputSchema,
  execute: async ({ inputData }) => {
    const { scenario, prompts, reports } = inputData;

    const combinedPackage = `
# Complete Scenario Training Package

## Generated Scenario
${scenario}

---

## LLM Prompts for Bart Character
${prompts}

---

## Supporting Documents
${reports}

---

*This scenario package was generated by analyzing your communication patterns and creating a targeted practice environment for conflict resolution with Bart.*
    `.trim();

    return {
      scenario,
      prompts,
      reports,
      combinedPackage,
    };
  },
});

export const scenarioPipelineWorkflow = createWorkflow({
  id: 'scenarioPipelineWorkflow',
  description: 'Multi-LLM pipeline that creates complete scenario packages from transcript analysis',
  inputSchema: ScenarioPipelineInputSchema,
  outputSchema: ScenarioPipelineOutputSchema,
})
  .then(createScenario)
  .then(createPrompts)
  .then(createReports)
  .commit();