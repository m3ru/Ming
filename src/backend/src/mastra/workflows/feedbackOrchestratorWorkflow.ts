import { createWorkflow, createStep } from "@mastra/core/workflows";
import { RuntimeContext } from "@mastra/core/di";
import { z } from "zod";
import { transcriptSummaryAnalyzerAgent } from "../agents/transcriptSummaryAnalyzerAgent";
import { reportAnnotationAgent } from "../agents/reportAnnotationAgent";
import {
  annotationPlanSchema,
  buildAnnotationSegments,
} from "../../lib/reportAnnotations";
import { geminiThinking, resolveTextProvider } from "../../lib/providers";

export const REPORT_PROMPT_VERSION = "summary-annotations-v2";
export const FeedbackOrchestratorInputSchema = z.object({
  transcript: z.string(),
  additionalContext: z.record(z.unknown()).optional(),
  resourceId: z.string().optional(),
  threadId: z.string().optional(),
});
type Input = z.infer<typeof FeedbackOrchestratorInputSchema>;

function generationOptions(maxOutputTokens: number) {
  const { provider, model } = resolveTextProvider();
  return {
    abortSignal: AbortSignal.timeout(90000),
    modelSettings: {
      // Reasoning counts against this cap: GPT-6 Luna's medium effort needs headroom.
      maxOutputTokens: provider === "gemini" ? 4096 : maxOutputTokens + 4096,
    },
    ...geminiThinking({ provider, model }),
  };
}

// Only aggregate timings and usage leave this boundary, never prompts or errors.
async function timed<
  T extends {
    text: string;
    finishReason?: string;
    error?: unknown;
    tripwire?: unknown;
    usage?: unknown;
  },
>(
  stage: string,
  generate: () => Promise<T>,
  validate?: (result: T) => void,
): Promise<T> {
  const started = performance.now();
  let succeeded = false;
  let usage: unknown;
  let failureCode = "provider_failure";
  try {
    const result = await generate();
    usage = result.usage;
    if (result.finishReason === "length")
      throw new Error(
        "Report generation reached its output limit. Try generating the report again.",
      );
    if (
      result.error ||
      result.tripwire ||
      !result.text.trim() ||
      (result.finishReason !== undefined && result.finishReason !== "stop")
    )
      throw new Error("Incomplete report generation.");
    failureCode = "invalid_output";
    validate?.(result);
    succeeded = true;
    return result;
  } catch (error) {
    const reasons: Record<string, string> = {
      "Invalid annotation JSON.": "invalid_json",
      "Invalid segment boundary.": "invalid_boundary",
      "Highlight is outside a user turn.": "outside_user_turn",
      "Highlight quote is absent from source.": "quote_not_found",
      "Highlight includes speaker label.": "speaker_label",
      "Overlapping highlights.": "overlapping_quotes",
      "Highlight quote is absent or ambiguous in user speech.":
        "unresolved_quote",
    };
    if (error instanceof Error && reasons[error.message])
      failureCode = reasons[error.message];
    throw new Error("The report could not be generated. Try again.");
  } finally {
    const tokens = usage as
      | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
      | undefined;
    console.info(
      JSON.stringify({
        event: "debrief_generation",
        stage,
        durationMs: Math.round(performance.now() - started),
        succeeded,
        failureCode: succeeded ? undefined : failureCode,
        inputTokens: tokens?.inputTokens,
        outputTokens: tokens?.outputTokens,
        totalTokens: tokens?.totalTokens,
      }),
    );
  }
}

export async function generateReportSummary(input: Input) {
  const runtimeContext = new RuntimeContext();
  runtimeContext.set("additionalContext", input.additionalContext);
  const result = await timed("summary", () =>
    transcriptSummaryAnalyzerAgent.generateVNext(
      [
        "Analyze this workplace conversation transcript for overall summary: " +
          input.transcript,
        "Additional context: " + JSON.stringify(input.additionalContext ?? {}),
      ],
      { runtimeContext, ...generationOptions(2048) },
    ),
  );
  return result.text;
}

export async function generateReportAnnotations(input: Input) {
  let segments: ReturnType<typeof buildAnnotationSegments> | undefined;
  await timed(
    "annotations",
    () =>
      reportAnnotationAgent.generateVNext(
        [
          JSON.stringify({
            lines: input.transcript
              .split("\n")
              .map((text, line) => ({ line, text })),
            additionalContext: input.additionalContext ?? {},
          }),
        ],
        { ...generationOptions(1536), output: annotationPlanSchema },
      ),
    (result) => {
      // Strict final JSON avoids treating SDK-repaired partial output as complete.
      let plan: unknown;
      try {
        plan = JSON.parse(result.text);
      } catch {
        throw new Error("Invalid annotation JSON.");
      }
      let rejectedHighlights = 0;
      segments = buildAnnotationSegments(input.transcript, plan, () => {
        rejectedHighlights++;
      });
      if (rejectedHighlights)
        console.info(
          JSON.stringify({
            event: "debrief_annotation_validation",
            rejectedHighlights,
          }),
        );
    },
  );
  if (!segments)
    throw new Error("The transcript notes could not be generated. Try again.");
  return segments;
}

export const FeedbackOrchestratorOutputSchema = z.object({
  segmentedAnalysis: z.string(),
  summaryAnalysis: z.string(),
  detailedFeedback: z.string(),
  annotationSegments: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
      highlights: z.array(
        z.object({
          start: z.number(),
          end: z.number(),
          color: z.enum(["red", "yellow", "green"]),
          feedback: z.string(),
        }),
      ),
    }),
  ),
});
export type FeedbackOrchestratorOutput = z.infer<
  typeof FeedbackOrchestratorOutputSchema
>;

export function reportResult(
  summaryAnalysis: string,
  annotationSegments: Awaited<ReturnType<typeof generateReportAnnotations>>,
) {
  // Legacy strings remain useful to existing coaching context consumers.
  const transcript = annotationSegments
    .map(
      (segment) =>
        `<segment:${segment.title}>\n${segment.content}\n</segment:${segment.title}>`,
    )
    .join("\n\n");
  return {
    summaryAnalysis,
    segmentedAnalysis: transcript,
    detailedFeedback: transcript,
    annotationSegments,
  };
}

const generateReport = createStep({
  id: "generateReport",
  inputSchema: FeedbackOrchestratorInputSchema,
  outputSchema: FeedbackOrchestratorOutputSchema,
  execute: async ({ inputData }) => {
    const [summary, annotations] = await Promise.all([
      generateReportSummary(inputData),
      generateReportAnnotations(inputData),
    ]);
    return reportResult(summary, annotations);
  },
});
export const feedbackOrchestratorWorkflow = createWorkflow({
  id: "feedbackOrchestratorWorkflow",
  inputSchema: FeedbackOrchestratorInputSchema,
  outputSchema: FeedbackOrchestratorOutputSchema,
})
  .then(generateReport)
  .commit();
