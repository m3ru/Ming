import { Scenarios } from "@/backend/src/lib/scenarios";
import MarkdownRenderer from "@/cedar/components/chatMessages/MarkdownRenderer";
import { ConversationError } from "@/cedar/components/chatMessages/ConversationError";
import { isChatErrorMessage } from "@/lib/chatErrors";
import { Avatar, AvatarImage } from "@radix-ui/react-avatar";
import { Message, MessageRenderer, useCedarStore } from "cedar-os";
import React from "react";

interface ChatRendererProps {
  message: Message;
}

export const ChatRenderer: React.FC<ChatRendererProps> = ({ message }) => {
  const getMessageRenderers = useCedarStore(
    (state) => state.getMessageRenderers,
  );
  // The report's coaching chat runs on its own "transcript-" thread (TranscriptChatPanel).
  const isCoachThread = useCedarStore((state) =>
    state.mainThreadId.startsWith("transcript-"),
  );

  // Errors belong to the interface, rather than the role-play character.
  if (isChatErrorMessage(message)) return <ConversationError />;

  // Check if there is a registered renderer for this message type
  const renderer = getMessageRenderers(message.type) as
    | MessageRenderer<Message>
    | undefined;

  if (renderer) {
    // If renderer has validation, ensure compatibility
    if (!renderer.validateMessage || renderer.validateMessage(message)) {
      return <>{renderer.render(message)}</>;
    }
  }

  const isUser = message.role !== "bot" && message.role !== "assistant";
  const npc = Scenarios.negativeReview.npcs[0];

  return (
    <div className={isUser ? "w-fit max-w-[85%]" : "w-full max-w-[92%]"}>
      <div
        className={`mb-1 flex items-center gap-2 ${isUser ? "justify-end" : "justify-start"}`}
      >
        {!isUser && !isCoachThread && (
          <Avatar>
            <AvatarImage
              className="size-7 rounded-full object-cover"
              src={npc.pfp}
              alt=""
            />
          </Avatar>
        )}
        <div className="text-sm font-semibold text-ink">
          {isUser ? "You" : isCoachThread ? "Coach" : npc.name}
        </div>
      </div>
      <div
        className={
          isUser
            ? "w-fit rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-[15px] leading-relaxed text-ink [&_p+p]:mt-2"
            : "w-fit rounded-2xl rounded-tl-md border border-rule bg-white px-3.5 py-2.5 text-[15px] leading-relaxed text-ink [&_p+p]:mt-2"
        }
      >
        <MarkdownRenderer
          content={
            message.content ??
            ` \`\`\`json\n${JSON.stringify(message, null, 2)}\n\`\`\``
          }
        />
      </div>
    </div>
  );
};

export default ChatRenderer;
