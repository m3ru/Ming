import { createReportCache, reportCacheKey } from "../lib/reportCache";
import { resolveTextProvider } from "../lib/providers";
import { reserveGeneration } from "../lib/security";
import {
  generateReportSummary,
  generateReportAnnotations,
  reportResult,
  REPORT_PROMPT_VERSION,
} from "./workflows/feedbackOrchestratorWorkflow";

const summaries = createReportCache<string>();
const annotations =
  createReportCache<Awaited<ReturnType<typeof generateReportAnnotations>>>();
type Input = {
  transcript: string;
  additionalContext?: Record<string, unknown>;
  resourceId: string;
  threadId: string;
};
async function reserved<T>(
  identity: string,
  generate: () => Promise<T>,
): Promise<T> {
  const release = reserveGeneration(identity, 4);
  try {
    return await generate();
  } finally {
    release();
  }
}

export async function getReport(
  input: Input,
  stage: "complete" | "summary" | "annotations",
) {
  const { provider, model } = resolveTextProvider();
  const key = reportCacheKey({
    ...input,
    provider,
    model,
    promptVersion: REPORT_PROMPT_VERSION,
  });
  // Start both independently. The summary request warms the annotation cache;
  // navigation does not abort that bounded backend job. Retries share in-flight work.
  const notes = () =>
    annotations(key, () =>
      reserved(input.resourceId, () => generateReportAnnotations(input)),
    );
  if (stage === "annotations")
    return {
      annotationSegments: await notes(),
      annotationStatus: "ready" as const,
    };
  const summary = summaries(key, () =>
    reserved(input.resourceId, () => generateReportSummary(input)),
  );
  void summary.catch(() => {});
  const detail = notes();
  // Contain a background failure even if summary itself fails first.
  void detail.catch(() => {});
  if (stage === "summary")
    return {
      ...reportResult(await summary, [
        { title: "Conversation", content: input.transcript, highlights: [] },
      ]),
      annotationStatus: "pending" as const,
    };
  const [summaryText, segments] = await Promise.all([summary, detail]);
  return {
    ...reportResult(summaryText, segments),
    annotationStatus: "ready" as const,
  };
}
