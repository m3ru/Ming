import { parseAnnotationSegments } from "./reportAnnotations";

/** Replace only the same saved report. Navigating/replacing a session cannot
 * attach a late annotation response to a newer conversation. */
export async function completeReportAnnotations(options: {
  raw: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  fetch: typeof fetch;
  signal: AbortSignal;
}): Promise<boolean> {
  const saved = JSON.parse(options.raw);
  if (
    saved.annotationStatus !== "pending" ||
    typeof saved.transcript !== "string" ||
    typeof saved.sessionId !== "string"
  )
    return false;
  // Native browser fetch rejects an arbitrary receiver ("Illegal invocation").
  // Invoke the injected function directly, rather than as an options method.
  const fetchReport = options.fetch;
  const response = await fetchReport("/api/backend/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      stage: "annotations",
      threadId: saved.sessionId,
      transcript: saved.transcript,
      additionalContext: saved.additionalContext,
    }),
  });
  if (!response.ok)
    throw new Error("Transcript notes are unavailable. Your summary is saved.");
  const result = await response.json();
  const segments = parseAnnotationSegments(
    result.result?.annotationSegments,
    saved.transcript,
  );
  if (result.status !== "success" || !segments)
    throw new Error("Transcript notes are incomplete. Your summary is saved.");
  if (
    options.signal.aborted ||
    options.storage.getItem("reportData") !== options.raw
  )
    return false;
  // The original transcript and summary stay byte-for-byte unchanged.
  options.storage.setItem(
    "reportData",
    JSON.stringify({
      ...saved,
      annotationSegments: segments,
      annotationStatus: "ready",
    }),
  );
  return true;
}
