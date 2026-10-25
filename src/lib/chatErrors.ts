import type { CedarStore } from "cedar-os";

/** Cedar turns transport failures into this ordinary assistant text message. */
const CEDAR_SEND_ERROR = "An error occurred while sending your message.";

export function isChatErrorMessage(message: {
  type?: string;
  role?: string;
  content?: string;
  message?: string;
}): boolean {
  return (
    message.type === "error" ||
    (message.role !== "user" &&
      message.type === "text" &&
      message.content === CEDAR_SEND_ERROR)
  );
}
/** Keep failed partial replies visible while excluding them from evaluation. */
export function markFailedChatMessages(
  state: Pick<CedarStore, "getThreadMessages" | "updateMessage">,
  threadId: string,
  previousIds: ReadonlySet<string>,
) {
  for (const message of state.getThreadMessages(threadId)) {
    if (
      !previousIds.has(message.id) &&
      message.role !== "user" &&
      message.type === "text"
    ) {
      state.updateMessage(
        message.id,
        { metadata: { ...message.metadata, generationFailed: true } },
        threadId,
      );
    }
  }
}
