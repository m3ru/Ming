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

  // Get common message styling
  const getMessageStyles = (role: string) => {
    const commonClasses =
      "prose prose-sm inline-block rounded-xl relative text-sm w-fit";
    const roleClasses =
      role === "bot" || role === "assistant"
        ? `dark:text-gray-100 text-[black] w-full`
        : "text-[white] px-2 py-1 lg:px-3 lg:py-2";

    const style =
      role === "bot" || role === "assistant"
        ? {
            // boxShadow: "0 2px 10px rgba(0, 0, 0, 0.1)",
            // backgroundColor: "#aaaaaa",
            // color: "#ffffff",
          }
        : {
            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.1)",
            backgroundColor: "#3b82f6",
            color: "#ffffff",
          };

    return {
      className: `${commonClasses} ${roleClasses}`,
      style,
    };
  };

  return (
    <div
      className={`${
        message.role === "bot" || message.role === "assistant"
          ? "max-w-[100%] w-full"
          : "max-w-[80%] w-fit"
      }`}
    >
      <div
        className={`flex items-end ${message.role === "user" ? "justify-end" : "justify-start"} lg:mb-1 space-x-1 lg:space-x-2`}
      >
        {(message.role === "bot" || message.role === "assistant") && (
          <Avatar>
            <AvatarImage
              className="rounded-full h-6 w-6 g:h-8 lg:w-8"
              src={Scenarios.negativeReview.npcs[0].pfp}
              alt={Scenarios.negativeReview.npcs[0].name}
            />
          </Avatar>
        )}
        <div className="text-sm text-gray-500">
          {message.role === "user"
            ? "You"
            : Scenarios.negativeReview.npcs[0].name}
        </div>
      </div>
      <div {...getMessageStyles(message.role)}>
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
