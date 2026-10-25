import { useVoiceSession } from "@/hooks/useVoiceSession";
import { groupConversationMessages } from "@/lib/groupConversationMessages";
import { cn, useCedarStore, useThreadMessages } from "cedar-os";
import { AnimatePresence, motion } from "motion/react";
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import ChatRenderer, { TypingBubble } from "./ChatRenderer";

const enter = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;

interface ChatBubblesProps {
  maxHeight?: string; // e.g., "300px", "60vh", or undefined for flex-1
  className?: string; // Additional classes for the container
}

export const ChatBubbles: React.FC<ChatBubblesProps> = ({
  maxHeight,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isProcessing = useCedarStore((state) => state.isProcessing);
  const voice = useVoiceSession();
  // Use useThreadMessages hook to get messages for current thread
  const { messages } = useThreadMessages();
  const displayMessages = useMemo(
    () => groupConversationMessages(messages),
    [messages],
  );
  // A typed reply is pending until its first words stream in. A Deepgram voice
  // turn produces the reply inside one request, so it is pending while working.
  const last = displayMessages.at(-1);
  const replyStreaming =
    last?.role !== "user" && last?.type === "text" && !!last.content?.trim();
  const showTyping =
    (isProcessing && !replyStreaming) ||
    (voice.provider === "deepgram" && voice.working);

  // Immediate scroll to bottom on initial render (before paint)
  useLayoutEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, showTyping]);

  // Determine container classes based on maxHeight with proper className merging
  const containerClasses = maxHeight
    ? cn("overflow-x-hidden overflow-y-auto px-4", className)
    : cn("flex-1 overflow-x-hidden overflow-y-auto min-h-0 px-4", className);

  const containerStyle = maxHeight
    ? { height: maxHeight, contain: "paint layout" }
    : { contain: "paint layout" };

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full h-full mb-0 flex flex-col pb-3 relative",
        containerClasses,
      )}
      style={{
        ...containerStyle,
        // Custom scrollbar styles for Firefox
        scrollbarColor: "var(--rule) transparent",
      }}
    >
      {/* Messages container */}
      <div className="relative z-20 py-1">
        <AnimatePresence initial={false}>
          {displayMessages.map((message) => {
            const isUser = message.role === "user";
            return (
              <motion.div
                key={message.id}
                // Transform only, so streaming text never re-runs a layout animation.
                initial={{ opacity: 0, x: isUser ? 24 : -24, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={enter}
                style={{ transformOrigin: isUser ? "100% 100%" : "0% 0%" }}
                className={`flex ${
                  isUser ? "justify-end" : "justify-start"
                } mt-4 first:mt-1`}
              >
                <ChatRenderer message={message} />
              </motion.div>
            );
          })}
        </AnimatePresence>
        {/* Removed without an exit so the reply takes its place in one step. */}
        {showTyping && (
          <motion.div
            initial={{ opacity: 0, x: -16, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={enter}
            style={{ transformOrigin: "0% 0%" }}
            className="mt-4 flex justify-start first:mt-1"
          >
            <TypingBubble />
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default ChatBubbles;
