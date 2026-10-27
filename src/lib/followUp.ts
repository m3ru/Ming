import { scenarioSchema } from "@/lib/scenarioSchema";
import type { Scenario } from "@/lib/types";

const CACHE_KEY = "ming.followUp.v1";
const MAX_ANALYSIS = 96_000;
export type FollowUpSource = {
  reportId: string;
  rawReport: string;
  threadId: string;
  analysis: string;
};
export type FollowUpState =
  | { status: "idle"; message?: string }
  | { status: "loading" }
  | { status: "ready"; scenario: Scenario }
  | { status: "error"; message: string };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// The exact saved report is also compared when restoring the cache, so a hash
// collision or a reused session ID cannot attach another report's follow-up.
export function followUpSource(rawReport: string): FollowUpSource | undefined {
  const saved: unknown = JSON.parse(rawReport);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
  const record = saved as Record<string, unknown>;
  // Annotation enrichment does not change the feedback used for a follow-up.
  // Keep its source identity stable while transcript notes arrive in the UI.
  const structured = Array.isArray(record.annotationSegments);
  if (structured) rawReport = JSON.stringify({
    sessionId: record.sessionId, summary: record.summary, transcript: record.transcript,
    createdAt: record.createdAt, additionalContext: record.additionalContext,
  });
  const threadId =
    typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  const summary =
    typeof record.summary === "string" ? record.summary.trim() : "";
  const analysisText =
    !structured && typeof record.analysis === "string" ? record.analysis.trim() : "";
  if (!threadId || (!summary && !analysisText)) return;
  const analysis = [
    summary && `Completed report:\n${summary}`,
    analysisText && `Detailed analysis:\n${analysisText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (analysis.length > MAX_ANALYSIS) return;
  let hash = 2166136261;
  for (let i = 0; i < rawReport.length; i++)
    hash = Math.imul(hash ^ rawReport.charCodeAt(i), 16777619);
  const reportId =
    typeof record.reportId === "string" && record.reportId.trim()
      ? record.reportId.trim()
      : `${threadId}:${rawReport.length}:${(hash >>> 0).toString(16)}`;
  return { reportId, rawReport, threadId, analysis };
}

export function readFollowUpCache(
  storage: StorageLike,
  source: FollowUpSource,
): Scenario | undefined {
  const raw = storage.getItem(CACHE_KEY);
  if (!raw) return;
  let cached: unknown;
  try {
    cached = JSON.parse(raw);
  } catch {
    return;
  }
  if (!cached || typeof cached !== "object" || Array.isArray(cached)) return;
  const record = cached as Record<string, unknown>;
  if (
    record.sourceReportId !== source.reportId ||
    record.sourceReport !== source.rawReport
  )
    return;
  const result = scenarioSchema.safeParse(record.scenario);
  return result.success ? result.data : undefined;
}

export function createFollowUpController(options: {
  storage: () => StorageLike;
  fetch: typeof fetch;
  onState: (state: FollowUpState) => void;
  timeoutMs?: number;
}) {
  let source: FollowUpSource | undefined;
  let active: AbortController | undefined;
  let ready: Scenario | undefined;
  const emit = options.onState;
  const cancel = (announce = true) => {
    const request = active;
    active = undefined;
    request?.abort();
    if (announce)
      emit(
        ready
          ? { status: "ready", scenario: ready }
          : {
              status: "idle",
              message: "Generation cancelled. Your report is still available.",
            },
      );
  };
  const setSource = (next: FollowUpSource | undefined) => {
    cancel(false);
    source = next;
    ready = undefined;
    if (!next) {
      emit({ status: "idle" });
      return;
    }
    try {
      ready = readFollowUpCache(options.storage(), next);
      emit(ready ? { status: "ready", scenario: ready } : { status: "idle" });
    } catch {
      emit({
        status: "error",
        message:
          "This browser could not read the saved follow-up. Allow site storage, then try again. Your report is still available.",
      });
    }
  };
  const generate = async () => {
    // Lock synchronously: rapid clicks cannot send multiple paid requests.
    if (active || !source) return;
    const requestSource = source;
    const request = new AbortController();
    active = request;
    emit({ status: "loading" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      request.abort();
    }, options.timeoutMs ?? 120_000);
    try {
      const response = await options.fetch("/api/backend/scenario-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis: requestSource.analysis,
          threadId: requestSource.threadId,
          additionalContext: { sourceReportId: requestSource.reportId },
        }),
        signal: request.signal,
      });
      if (!response.ok)
        throw new Error(
          "Follow-up generation is unavailable. Try again when the service is available.",
        );
      const payload: unknown = await response.json();
      if (active !== request || source !== requestSource) return;
      if (request.signal.aborted) throw new Error("Generation stopped.");
      const envelope = payload as {
        status?: unknown;
        result?: { scenario?: unknown };
      } | null;
      const parsed = scenarioSchema.safeParse(
        envelope?.status === "success" ? envelope.result?.scenario : undefined,
      );
      if (!parsed.success)
        throw new Error(
          "The generated follow-up was incomplete. Select Retry to request a complete scenario.",
        );
      try {
        options.storage().setItem(
          CACHE_KEY,
          JSON.stringify({
            sourceReportId: requestSource.reportId,
            sourceReport: requestSource.rawReport,
            scenario: parsed.data,
          }),
        );
      } catch {
        throw new Error(
          "The follow-up could not be saved in this browser. Allow site storage, then select Retry. Your report is still available.",
        );
      }
      ready = parsed.data;
      emit({ status: "ready", scenario: ready });
    } catch (error) {
      if (active !== request || source !== requestSource) return;
      emit({
        status: "error",
        message: timedOut
          ? "Follow-up generation took too long. Your report is still available. Select Retry to try again."
          : error instanceof Error && !request.signal.aborted
            ? error.message
            : "Follow-up generation stopped. Your report is still available. Select Retry to try again.",
      });
    } finally {
      clearTimeout(timer);
      if (active === request) active = undefined;
    }
  };
  return { setSource, generate, cancel };
}
