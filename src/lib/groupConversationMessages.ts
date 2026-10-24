import type { Message } from "cedar-os";

// Build display messages without changing the transcript used by voice,
// persistence, sentiment scoring, or reports. Keep the first ID stable as a
// speaker's bubble grows, including while later messages are streaming.
export function groupConversationMessages(
  messages: readonly Message[],
): Message[] {
  const grouped: Message[] = [];
  for (const message of messages) {
    // These tool events have hidden renderers and do not separate visible turns.
    if (message.type === "tool-call" || message.type === "tool-result")
      continue;
    const previous = grouped.at(-1);
    const side = message.role === "user" ? "user" : "assistant";
    const previousSide = previous?.role === "user" ? "user" : "assistant";
    if (
      previous?.type === "text" &&
      message.type === "text" &&
      side === previousSide
    ) {
      grouped[grouped.length - 1] = {
        ...previous,
        content: [previous.content, message.content]
          .filter(Boolean)
          .join("\n\n"),
      };
    } else {
      grouped.push(message);
    }
  }
  return grouped;
}
