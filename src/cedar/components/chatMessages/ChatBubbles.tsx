import { ShimmerText } from "@/cedar/components/text/ShimmerText";
import { groupConversationMessages } from "@/lib/groupConversationMessages";
import { cn, useCedarStore, useThreadMessages } from "cedar-os";
import { AnimatePresence, motion } from "motion/react";
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import ChatRenderer from "./ChatRenderer";

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
  // Use useThreadMessages hook to get messages for current thread
  const { messages } = useThreadMessages();
  const displayMessages = useMemo(
    () => groupConversationMessages(messages),
    [messages],
  );

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
  }, [messages]);

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
          {displayMessages.map((message) => (
            <motion.div
              key={message.id}
              initial={{
                opacity: 0,
                y: 20,
                filter: "blur(4px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              transition={{
                duration: 0.15,
                ease: "easeOut",
              }}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              } mt-4 first:mt-1`}
            >
              <ChatRenderer message={message} />
            </motion.div>
          ))}
          {isProcessing && (
            <div className="pt-4 pb-1">
              <ShimmerText text="Thinking…" state="thinking" />
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ChatBubbles;
