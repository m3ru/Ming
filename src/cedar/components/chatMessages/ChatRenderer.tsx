import { Scenarios } from "@/backend/src/lib/scenarios";
import DialogueOptions from "@/cedar/components/chatMessages/DialogueOptions";
import MarkdownRenderer from "@/cedar/components/chatMessages/MarkdownRenderer";
import MultipleChoice from "@/cedar/components/chatMessages/MultipleChoice";
import TodoList from "@/cedar/components/chatMessages/TodoList";
import Flat3dContainer from "@/cedar/components/containers/Flat3dContainer";
import { Avatar, AvatarImage } from "@radix-ui/react-avatar";
import {
  DialogueOptionsMessage,
  Message,
  MessageRenderer,
  MultipleChoiceMessage,
  TickerMessage,
  TodoListMessage,
  useCedarStore,
} from "cedar-os";
import { Ticker } from "motion-plus-react";
import React from "react";

interface ChatRendererProps {
  message: Message;
}

export const ChatRenderer: React.FC<ChatRendererProps> = ({ message }) => {
  const getMessageRenderers = useCedarStore(
    (state) => state.getMessageRenderers
  );

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

  // Gradient mask for ticker edges
  const mask =
    "linear-gradient(to right, transparent 5%, black 15%, black 85%, transparent 95%)";
  // Get common message styling
  const getMessageStyles = (role: string) => {
    const commonClasses =
      "prose prose-sm inline-block rounded-xl relative text-sm w-fit";
    const roleClasses =
      role === "bot" || role === "assistant"
        ? `dark:text-gray-100 text-[black] w-full`
        : "text-[white] px-3 py-2";

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
        className={`flex items-end ${message.role === "user" ? "justify-end" : "justify-start"} mb-1 space-x-2`}
      >
        {(message.role === "bot" || message.role === "assistant") && (
          <Avatar>
            <AvatarImage
              className="rounded-full h-8 w-8"
              src={Scenarios.demandingClient.npcs[0].pfp}
              alt={Scenarios.demandingClient.npcs[0].name}
            />
          </Avatar>
        )}
        <div className="text-sm text-gray-500">
          {message.role === "user"
            ? "You"
            : Scenarios.demandingClient.npcs[0].name}
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
