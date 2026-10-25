import type { CedarStore } from "cedar-os";

type StreamState = Pick<CedarStore, "streamLLM">;

/**
 * Cedar consumes transport-error events without rejecting sendMessage. Observe
 * the next stream only, restoring the shared method as soon as it is called.
 */
export function observeNextChatStream(
  getState: () => StreamState,
  setState: (patch: StreamState) => void,
) {
  const original = getState().streamLLM;
  let failed = false;
  const restore = () => {
    if (getState().streamLLM === observed) setState({ streamLLM: original });
  };
  const observed: StreamState["streamLLM"] = (params, handler) => {
    restore();
    const pending: Promise<void>[] = [];
    const response = original(params, (event) => {
      if (
        event.type === "error" ||
        (event.type === "object" &&
          (Array.isArray(event.object) ? event.object : [event.object]).some(
            (item) => item.type === "error",
          ))
      )
        failed = true;
      const processing = Promise.resolve(handler(event));
      pending.push(processing);
      // The provider may ignore the callback promise until streaming finishes.
      // Handle rejection now; completion still propagates it via Promise.all.
      void processing.catch(() => {});
      return processing;
    });
    return {
      ...response,
      completion: (async () => {
        try {
          await response.completion;
        } finally {
          // Cedar's SSE parser does not await its async message handlers.
          // Settle them before deciding whether this generation succeeded.
          await Promise.all(pending);
        }
      })(),
    };
  };
  setState({ streamLLM: observed });
  return { hasFailed: () => failed, restore };
}
