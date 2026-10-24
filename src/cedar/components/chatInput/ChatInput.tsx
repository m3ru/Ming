import { cn, useCedarStore, HumanInTheLoopMessage } from "cedar-os";

import { CedarEditorContent as EditorContent } from "cedar-os";
import { Mic, MicOff, PhoneOff, SendHorizonal } from "lucide-react";
import { motion } from "motion/react";
import React, { useEffect } from "react";

import "./ChatInput.css";
import { ContextBadgeRow } from "@/cedar/components/chatInput/ContextBadgeRow";
import { useCedarEditor } from "cedar-os";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { KeyboardShortcut } from "@/cedar/components/ui/KeyboardShortcut";
import { HumanInTheLoopIndicator } from "@/cedar/components/chatInput/HumanInTheLoopIndicator";

// ChatContainer component with position options
export type ChatContainerPosition = "bottom-center" | "embedded" | "custom";

// Inlined mention items removed; using external suggestion module

export const ChatInput: React.FC<{
  handleFocus?: () => void;
  handleBlur?: () => void;
  isInputFocused?: boolean;
  className?: string; // Additional classes for the container
  stream?: boolean; // Whether to use streaming for responses
}> = ({
  handleFocus,
  handleBlur,
  isInputFocused,
  className = "",
  stream = true,
}) => {
  const [isFocused, setIsFocused] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const submitting = React.useRef(false);
  const voice = useVoiceSession();
  const threadId = useCedarStore((state) => state.mainThreadId);
  const userId = useCedarStore((state) => state.getCedarState("userId"));
  const { start } = voice;

  // Connect as soon as Cedar has initialized the chat. Input starts muted;
  // holding Space only opens the live microphone, without a connection delay.
  useEffect(() => {
    if (threadId && userId) void start();
  }, [start, threadId, userId]);

  const { editor, isEditorEmpty, handleSubmit } = useCedarEditor({
    onSubmit: async (_text, _editor, clearEditor) => {
      if (submitting.current) return;
      submitting.current = true;
      setSendError(null);
      try {
        await voice.flush();
        const response = useCedarStore.getState().sendMessage({ stream });
        clearEditor?.();
        await response;
      } catch {
        setSendError("Could not send your message. Please try again.");
      } finally {
        submitting.current = false;
      }
    },
    onFocus: () => {
      setIsFocused(true);
      handleFocus?.();
    },
    onBlur: () => {
      setIsFocused(false);
      handleBlur?.();
    },
    stream,
  });

  // Get latest message to check for human-in-the-loop state
  const messages = useCedarStore((state) => state.messages);
  const latestMessage = messages[messages.length - 1];
  const isHumanInTheLoopSuspended =
    latestMessage?.type === "humanInTheLoop" &&
    (latestMessage as HumanInTheLoopMessage).state === "suspended";

  // Focus the editor when isInputFocused changes to allow for controlled focusing
  useEffect(() => {
    if (isInputFocused && editor) {
      editor.commands.focus();
    }
  }, [isInputFocused, editor]);

  // Handle tab key to focus the editor and escape to unfocus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        if (editor) {
          editor.commands.focus();
          setIsFocused(true);
        }
      } else if (e.key === "Escape") {
        if (isFocused && editor) {
          editor.commands.blur();
          setIsFocused(false);
        }
      }
    };

    // Add the event listener
    window.addEventListener("keydown", handleKeyDown);

    // Clean up
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor, isFocused]);

  // Keep the connection open between presses, but transmit only while held.
  const { beginTalking, endTalking } = voice;
  useEffect(() => {
    let spaceHeld = false;
    const release = () => {
      spaceHeld = false;
      endTalking();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (spaceHeld) {
        event.preventDefault();
        return;
      }
      const target = event.target;
      if (
        editor?.isFocused ||
        (target instanceof HTMLElement &&
          target.closest(
            'input, textarea, select, button, summary, a[href], [contenteditable="true"], [role="textbox"]',
          ))
      )
        return;
      if (
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      spaceHeld = true;
      void beginTalking();
    };
    const keyUp = (event: KeyboardEvent) => {
      if ((event.code === "Space" || event.key === " ") && spaceHeld) {
        event.preventDefault();
        release();
      }
    };
    const visibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, [editor, beginTalking, endTalking]);

  return (
    <div
      className={cn(
        "bg-gray-800/10 dark:bg-gray-600/80 rounded-lg p-2 lg:p-3 text-sm",
        className,
      )}
    >
      {/* Input context row showing selected context nodes */}
      <ContextBadgeRow editor={editor} />

      {/* Chat editor row */}
      <div
        className="max-lg:hidden relative w-full h-fit"
        id="cedar-chat-input"
      >
        {isHumanInTheLoopSuspended ? (
          <div className="py-2 items-center justify-center w-full">
            <HumanInTheLoopIndicator
              state={(latestMessage as HumanInTheLoopMessage).state}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {!isFocused && (
              <KeyboardShortcut
                shortcut="⇥"
                className="text-muted-foreground border-muted-foreground/30 flex-shrink-0"
              />
            )}
            <motion.div
              layoutId="chatInput"
              className="flex-1 justify-center py-3"
              aria-label="Message input"
            >
              <EditorContent
                editor={editor}
                className="prose prose-sm max-w-none focus:outline-none outline-none focus:ring-0 ring-0 [&_*]:focus:outline-none [&_*]:outline-none [&_*]:focus:ring-0 [&_*]:ring-0 placeholder-gray-500 dark:placeholder-gray-400 [&_.ProseMirror]:p-0 [&_.ProseMirror]:outline-none [&_.ProseMirror]:break-words [&_.ProseMirror]:overflow-wrap-anywhere [&_.ProseMirror]:word-break-break-word"
              />
            </motion.div>
          </div>
        )}
      </div>

      <div className="text-xs space-y-1" aria-live="polite">
        {voice.status === "connected" && (
          <p>
            {voice.muted
              ? "Hold Space or the microphone to talk"
              : "Listening…"}
            {voice.speaking ? " · Speaking" : ""}
            {voice.working ? " · Checking scenario…" : ""}
          </p>
        )}
        {voice.playbackBlocked && (
          <button
            type="button"
            onClick={() => {
              void voice.resumePlayback();
            }}
            className="underline"
          >
            Enable audio playback
          </button>
        )}
        {voice.error && (
          <p role="alert" className="text-red-600">
            {voice.error}
          </p>
        )}
        {sendError && (
          <p role="alert" className="text-red-600">
            {sendError}
          </p>
        )}
      </div>

      {/* Bottom rows. Contains tools and send chat button */}
      <div
        id="input-tools"
        className="flex items-center  space-x-2  justify-between"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1 p-1 cursor-pointer disabled:opacity-50"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              void voice.beginTalking();
            }}
            onPointerUp={voice.endTalking}
            onPointerCancel={voice.endTalking}
            onLostPointerCapture={voice.endTalking}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                if (!event.repeat) void voice.beginTalking();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                voice.endTalking();
              }
            }}
            onBlur={voice.endTalking}
            disabled={voice.status === "closing"}
            aria-label="Push to talk"
            aria-pressed={!voice.muted}
            title="Hold Space or hold this button to talk"
          >
            {voice.muted ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4 text-red-500" />
            )}
            <span>
              {voice.status === "connecting"
                ? "Connecting…"
                : voice.status === "closing"
                  ? "Finishing…"
                  : !voice.muted
                    ? "Microphone live"
                    : "Hold Space to talk"}
            </span>
          </button>
          {(voice.status === "connected" || voice.status === "connecting") && (
            <button
              type="button"
              onClick={() => {
                void voice.stop().catch(() => {});
              }}
              aria-label="End conversation"
              className="p-1 cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          )}
        </div>
        <div
          id="send-chat"
          onClick={() => handleSubmit()}
          className={`max-lg:hidden flex items-center flex-shrink-0 rounded-full ${isEditorEmpty ? "opacity-50 cursor-not-allowed" : "hover:shadow-lg cursor-pointer bg-blue-500 hover:bg-blue-600"} transition-all duration-300 p-2`}
        >
          <SendHorizonal className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
};
