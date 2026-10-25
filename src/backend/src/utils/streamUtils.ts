// ------------------- Functions for Data-Only SSE Format -------------------

const chatErrors = {
  AI_NOT_CONFIGURED: {
    message:
      "The AI service is not configured. Set GEMINI_API_KEY for Gemini or OPENAI_API_KEY for OpenAI in the root .env, then restart the backend.",
    retryable: true,
  },
  PROVIDER_UNAVAILABLE: {
    message: "The AI service is unavailable. Please try again in a moment.",
    retryable: true,
  },
  EMPTY_RESPONSE: {
    message: "The AI service returned no reply. Please try again.",
    retryable: true,
  },
  INVALID_CHAT_REQUEST: {
    message: "The chat request is invalid. Enter a message and try again.",
    retryable: false,
  },
} as const;

export class ChatStreamError extends Error {
  constructor(public readonly code: keyof typeof chatErrors) {
    super(chatErrors[code].message);
    this.name = "ChatStreamError";
  }
}

// Never send provider error messages, request bodies, stack traces, or keys to
// the browser. The same typed error is used before and after SSE has started.
export function publicChatError(error: unknown) {
  const code =
    error instanceof ChatStreamError ? error.code : "PROVIDER_UNAVAILABLE";
  return { type: "error" as const, code, ...chatErrors[code] };
}

/**
 * Uses SSE data-only format.
 * Only uses 'event: done' with empty data for completion.
 * All other content goes through 'data:' field only.
 */
export function createSSEStream(
  cb: (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await cb(controller);
        if (cancelled) return;
        // Signal completion with empty data
        controller.enqueue(encoder.encode("event: done\ndata:\n\n"));
      } catch (err) {
        if (cancelled) return;
        const error = publicChatError(err);
        console.error("Chat stream failed", error.code);
        streamJSONEvent(controller, "error", error);
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Emit any JSON object as a data event.
 * Used for actions, tool responses, custom events, etc.
 */
export function streamJSONEvent<T>(
  controller: ReadableStreamDefaultController<Uint8Array>,
  eventType: string,
  eventData: T,
) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`));
}

/**
 * Handles streaming of text chunks to SSE controller for Mastra's streamVNext compatibility
 *
 * @param streamResult - The StreamTextResult from an AI agent
 * @param streamController - Optional SSE stream controller
 * @returns Promise<string> - The complete response text
 */
export async function handleTextStream(
  chunk: string,
  streamController: ReadableStreamDefaultController<Uint8Array>,
): Promise<string> {
  const encoder = new TextEncoder();

  // Escape literal newlines for SSE compliance
  const escaped = chunk.replace(/\n/g, "\\n");
  streamController.enqueue(encoder.encode(`data:${escaped}\n\n`));

  return chunk;
}
