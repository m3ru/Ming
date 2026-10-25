import { cn, useCedarStore, HumanInTheLoopMessage } from "cedar-os";

import { CedarEditorContent as EditorContent } from "cedar-os";
import { CircleAlert, Mic, PhoneOff, SendHorizonal, VolumeX } from "lucide-react";
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

// Failures where sending the same draft again is the recovery.
const NO_REPLY = "No reply came back. Your draft is still here.";
const SEND_FAILED = "Couldn't send your message. Your draft is still here.";
const NOTE_ACTION =
  "-my-2 min-h-11 shrink-0 cursor-pointer self-center rounded-lg px-2.5 font-semibold text-pencil transition-colors hover:bg-pencil/10 disabled:cursor-not-allowed disabled:opacity-50";

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
            "The conversation changed before sending. Check your draft.",
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
          setSendError(NO_REPLY);
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
            : SEND_FAILED,
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
  // Honest states only: the mic is open, or a released turn is being worked on.
  const live = voice.status === "connected" && !voice.muted;
  const voiceLabel = live
    ? "Listening…"
    : voice.working
      ? voice.provider === "deepgram"
        ? "Processing your voice…"
        : "Checking the scenario…"
      : null;
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

      <div className="mb-2 space-y-2 px-1 text-xs text-ink-soft" aria-live="polite">
        {voiceLabel ? (
          <div className="flex min-h-5 items-center gap-2">
            <span
              aria-hidden="true"
              className={`voice-wave ${live ? "is-listening text-red-pencil" : "is-working text-pencil"}`}
            >
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
            <p
              key={voiceLabel}
              className={`enter-pop text-sm font-semibold ${live ? "text-red-pencil" : "text-ink"}`}
            >
              {voiceLabel}
            </p>
          </div>
        ) : voice.status === "connecting" ? (
          <p>Connecting voice… Allow the microphone if asked.</p>
        ) : voice.status === "closing" ? (
          <p>Saving voice conversation… You can still type.</p>
        ) : voice.status === "connected" ? (
          <p>
            Hold Space or the microphone to talk
            {voice.speaking ? " · Speaking" : ""}
          </p>
        ) : (
          !voice.error && (
            <p>
              Voice is off. Hold the microphone to connect, or type a message.
            </p>
          )
        )}
        {voice.playbackBlocked && (
          <div className="alert-note">
            <VolumeX
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-red-pencil"
            />
            <p className="min-w-0 flex-1">The browser blocked audio.</p>
            <button
              type="button"
              onClick={() => {
                void voice.resumePlayback();
              }}
              className={NOTE_ACTION}
            >
              Enable audio
            </button>
          </div>
        )}
        {(voice.error || voice.canContinueByText) && (
          <div role="alert" className="alert-note">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-red-pencil"
            />
            <div className="min-w-0 flex-1">
              <p>{voice.error ?? "Your last recording didn't send."}</p>
              {voice.canContinueByText && (
                <p className="mt-0.5 text-xs text-ink-soft">
                  Continue by text drops it. Saved messages stay.
                </p>
              )}
            </div>
            {voice.canContinueByText && (
              <button
                type="button"
                className={NOTE_ACTION}
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
                          : "Couldn't switch to text. Try again.",
                      );
                    });
                }}
              >
                Continue by text
              </button>
            )}
          </div>
        )}
        {sendError && (
          <div role="alert" className="alert-note">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-red-pencil"
            />
            <p className="min-w-0 flex-1">{sendError}</p>
            {(sendError === NO_REPLY || sendError === SEND_FAILED) && (
              <button
                type="button"
                className={NOTE_ACTION}
                disabled={isEditorEmpty || isSending || isProcessing}
                onClick={() => void handleSubmit()}
              >
                Send again
              </button>
            )}
          </div>
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
            className={`flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-full px-4 font-semibold text-white transition-[background-color,scale] duration-150 ease-out disabled:opacity-50 ${
              voice.muted
                ? "bg-pencil enabled:hover:bg-pencil/90"
                : "scale-[1.04] bg-red-pencil"
            } ${live ? "mic-live" : ""}`}
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
                    ? "Release to send"
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
