import { cn, useCedarStore, HumanInTheLoopMessage } from "cedar-os";

import { CedarEditorContent as EditorContent } from "cedar-os";
import { Mic, PhoneOff, SendHorizonal } from "lucide-react";
import { motion } from "motion/react";
import React, { useEffect } from "react";

import "./ChatInput.css";
import { ContextBadgeRow } from "@/cedar/components/chatInput/ContextBadgeRow";
import { useCedarEditor } from "cedar-os";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { HumanInTheLoopIndicator } from "@/cedar/components/chatInput/HumanInTheLoopIndicator";
import { isChatErrorMessage, markFailedChatMessages } from "@/lib/chatErrors";
import { observeNextChatStream } from "@/lib/chatStreamObserver";

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
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const submitting = React.useRef(false);
  const voice = useVoiceSession();
  const threadId = useCedarStore((state) => state.mainThreadId);
  const userId = useCedarStore((state) => state.getCedarState("userId"));
  const isProcessing = useCedarStore((state) => state.isProcessing);
  const { start } = voice;

  // Prepare the configured voice path once Cedar has initialized the chat.
  // Deepgram only requests microphone access when a press begins.
  useEffect(() => {
    if (threadId && userId) void start();
  }, [start, threadId, userId]);

  const { editor, isEditorEmpty, handleSubmit } = useCedarEditor({
    placeholder: "Type a message…",
    onSubmit: async (_text, submittedEditor, clearEditor) => {
      if (
        !submittedEditor ||
        submitting.current ||
        useCedarStore.getState().isProcessing
      )
        return;
      submitting.current = true;
      setIsSending(true);
      setSendError(null);
      const submittedContent = JSON.stringify(submittedEditor.getJSON());
      const requestedState = useCedarStore.getState();
      const requestedThreadId = requestedState.getCurrentThreadId();
      const requestedUserId = requestedState.getCedarState("userId");
      let submission: { threadId: string; previousIds: Set<string> } | null =
        null;
      try {
        await voice.flush();
        const state = useCedarStore.getState();
        if (
          state.getCurrentThreadId() !== requestedThreadId ||
          state.getCedarState("userId") !== requestedUserId
        )
          throw new Error(
            "The conversation changed before your message was sent. Review your draft in the current conversation.",
          );
        const submittedThreadId = state.getCurrentThreadId();
        const previousIds = new Set(
          state
            .getThreadMessages(submittedThreadId)
            .map((message) => message.id),
        );
        submission = { threadId: submittedThreadId, previousIds };
        const streamObserver = stream
          ? observeNextChatStream(useCedarStore.getState, (patch) =>
              useCedarStore.setState(patch),
            )
          : null;
        try {
          await state.sendMessage({ stream });
        } finally {
          streamObserver?.restore();
        }
        // Cedar resolves even on HTTP errors and error objects in an SSE stream.
        const newMessages = useCedarStore
          .getState()
          .getThreadMessages(submittedThreadId)
          .filter((message) => !previousIds.has(message.id));
        const failed =
          streamObserver?.hasFailed() ||
          newMessages.some(isChatErrorMessage) ||
          !newMessages.some(
            (message) =>
              message.role !== "user" &&
              message.type === "text" &&
              message.content?.trim(),
          );
        if (failed) {
          markFailedChatMessages(
            useCedarStore.getState(),
            submittedThreadId,
            previousIds,
          );
          setSendError(
            "The AI could not respond. Your draft is still here; select Send message to try again.",
          );
        } else if (
          JSON.stringify(submittedEditor.getJSON()) === submittedContent
        ) {
          clearEditor?.();
        }
      } catch (error) {
        if (submission) {
          markFailedChatMessages(
            useCedarStore.getState(),
            submission.threadId,
            submission.previousIds,
          );
        }
        setSendError(
          !submission && error instanceof Error
            ? error.message
            : "Could not send your message. Your draft is still here; select Send message to try again.",
        );
      } finally {
        // Cedar clears its input state after resolving. Keep the visible draft
        // in sync, including anything typed while the response was pending.
        if (
          !submittedEditor.isDestroyed &&
          useCedarStore.getState().getCurrentThreadId() === requestedThreadId &&
          useCedarStore.getState().getCedarState("userId") === requestedUserId
        ) {
          useCedarStore
            .getState()
            .setChatInputContent(submittedEditor.getJSON());
        }
        submitting.current = false;
        setIsSending(false);
      }
    },
    onFocus: () => {
      handleFocus?.();
    },
    onBlur: () => {
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

  // Label the actual contenteditable, rather than its presentation wrapper.
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("role", "textbox");
    editor.view.dom.setAttribute("aria-label", "Message");
    editor.view.dom.setAttribute("aria-multiline", "true");
  }, [editor]);

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
        "rounded-xl border border-rule bg-white p-2 text-sm text-ink lg:p-3",
        className,
      )}
    >
      {/* Input context row showing selected context nodes */}
      <ContextBadgeRow editor={editor} />

      {/* Chat editor row */}
      <div
        className="cedar-chat-editor relative w-full h-fit rounded-lg px-1 focus-within:ring-2 focus-within:ring-pencil/40"
        id="cedar-chat-input"
        onKeyDown={(event) => {
          if (event.key === "Escape" && editor?.isFocused) {
            editor.commands.blur();
          }
        }}
      >
        {isHumanInTheLoopSuspended ? (
          <div className="py-2 items-center justify-center w-full">
            <HumanInTheLoopIndicator
              state={(latestMessage as HumanInTheLoopMessage).state}
            />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <motion.div
              layoutId="chatInput"
              className="min-w-0 flex-1 justify-center py-2.5"
            >
              <EditorContent
                editor={editor}
                className="prose prose-sm max-w-none focus:outline-none outline-none focus:ring-0 ring-0 [&_*]:focus:outline-none [&_*]:outline-none [&_*]:focus:ring-0 [&_*]:ring-0 [&_.ProseMirror]:p-0 [&_.ProseMirror]:outline-none [&_.ProseMirror]:break-words [&_.ProseMirror]:overflow-wrap-anywhere [&_.ProseMirror]:word-break-break-word"
              />
            </motion.div>
          </div>
        )}
      </div>

      <div className="mb-2 space-y-1 px-1 text-xs text-ink-soft" aria-live="polite">
        {voice.status === "connecting" && (
          <p>
            Connecting voice… Allow microphone access if prompted. You can type
            while you wait.
          </p>
        )}
        {voice.status === "idle" && !voice.error && (
          <p>
            Voice is off. Hold the microphone to connect, or type a message.
          </p>
        )}
        {voice.status === "closing" && (
          <p>Saving voice conversation… You can still type a message.</p>
        )}
        {voice.status === "connected" && (
          <p>
            {voice.muted
              ? "Hold Space or the microphone to talk"
              : "Listening…"}
            {voice.speaking ? " · Speaking" : ""}
            {voice.working
              ? voice.provider === "deepgram"
                ? " · Processing voice…"
                : " · Checking scenario…"
              : ""}
          </p>
        )}
        {voice.playbackBlocked && (
          <button
            type="button"
            onClick={() => {
              void voice.resumePlayback();
            }}
            className="font-medium text-pencil underline underline-offset-2"
          >
            Enable audio playback
          </button>
        )}
        {voice.error && (
          <p role="alert" className="text-red-pencil">
            {voice.error}
          </p>
        )}
        {voice.canContinueByText && (
          <div>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-lg px-2 font-medium text-pencil underline underline-offset-2 disabled:opacity-50"
              disabled={isSending || isProcessing}
              onClick={() => {
                void voice
                  .continueByText?.()
                  .then(() => {
                    setSendError(null);
                    editor?.commands.focus();
                  })
                  .catch((error: unknown) => {
                    setSendError(
                      error instanceof Error
                        ? error.message
                        : "Could not continue by text. Please try again.",
                    );
                  });
              }}
            >
              Continue by text
            </button>
            <p>
              Discards the failed recording. Saved messages stay in the
              conversation. Then send your draft or select End conversation.
            </p>
          </div>
        )}
        {sendError && (
          <p role="alert" className="text-red-pencil">
            {sendError}
          </p>
        )}
      </div>

      {/* Bottom rows. Contains tools and send chat button */}
      <div
        id="input-tools"
        className="flex items-center justify-between gap-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-full px-4 font-semibold text-white transition-colors disabled:opacity-50 ${
              voice.muted
                ? "bg-pencil enabled:hover:bg-pencil/90"
                : "bg-red-pencil"
            }`}
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
            aria-label={
              voice.status === "connected"
                ? "Push to talk"
                : "Hold to connect voice and talk"
            }
            aria-pressed={!voice.muted}
            title="Hold Space or hold this button to talk"
          >
            <Mic className="size-4" />
            <span>
              {voice.status === "connecting"
                ? "Connecting…"
                : voice.status === "closing"
                  ? "Finishing…"
                  : !voice.muted
                    ? "Microphone live"
                    : voice.status === "connected"
                      ? "Hold to talk"
                      : "Hold to connect voice"}
            </span>
          </button>
          {(voice.status === "connected" || voice.status === "connecting") && (
            <button
              type="button"
              onClick={() => {
                void voice.stop().catch(() => {});
              }}
              aria-label="Disconnect voice"
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-red-pencil"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          id="send-chat"
          onClick={() => void handleSubmit()}
          disabled={
            isEditorEmpty ||
            isSending ||
            isProcessing ||
            isHumanInTheLoopSuspended
          }
          aria-label={isSending ? "Sending message" : "Send message"}
          title={isSending ? "Sending message…" : "Send message"}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-pencil p-2 text-white transition-colors enabled:cursor-pointer enabled:hover:bg-pencil/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendHorizonal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
