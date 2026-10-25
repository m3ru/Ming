import { isChatErrorMessage } from "./chatErrors";

export function buildReportTranscript(messages: Array<{ type?: string; role?: string; content?: string; metadata?: Record<string, unknown> }>): string | null {
  const dialogue = messages.filter((message) =>
    message.type === "text" && message.metadata?.generationFailed !== true && message.content?.trim() &&
    ["user", "assistant", "bot"].includes(message.role || "") && !isChatErrorMessage(message),
  );
  if (!dialogue.some((message) => message.role === "user") ||
      !dialogue.some((message) => message.role === "assistant" || message.role === "bot")) return null;
  return dialogue.map((message) => `${message.role === "user" ? "user" : "bart"}: ${message.content}`).join("\n");
}
