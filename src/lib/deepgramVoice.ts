import type { VoiceSnapshot } from "./liveVoice";
import type { ConversationMessage, VoiceTranscript } from "./voiceTranscript";

type VoiceScope = {
  threadId: string;
  resourceId: string;
  context: Record<string, unknown>;
  messages: ConversationMessage[];
};
export type DeepgramVoiceDependencies = {
  baseURL: () => string;
  scope: () => VoiceScope;
  messages: (threadId: string) => ConversationMessage[];
  transcript: (
    threadId: string,
    sessionId: string,
    messages: ReturnType<VoiceTranscript["messages"]>,
  ) => void;
};
type Turn = {
  epoch: number;
  resourceId: string;
  failed?: boolean;
  pending?: Promise<void>;
  serializedBody?: string;
  body: {
    turnId: string;
    threadId: string;
    audioBase64: string;
    mimeType: string;
    context: Record<string, unknown>;
    messages: ConversationMessage[];
  };
};
type Capture = {
  recorder: MediaRecorder;
  scope: VoiceScope;
  chunks: Blob[];
  bytes: number;
  done: Promise<Blob>;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  error?: Error;
};
type Session = {
  threadId: string;
  resourceId: string;
  microphone?: MediaStream;
  acquiring?: Promise<void>;
  capture?: Capture;
  pendingTurn?: Promise<void>;
  stopPromise?: Promise<void>;
  audio?: HTMLAudioElement;
  audioURL?: string;
  speech?: AbortController;
  audioReader?: ReadableStreamDefaultReader<Uint8Array>;
};
const initial: VoiceSnapshot = {
  status: "idle",
  muted: true,
  speaking: false,
  working: false,
  playbackBlocked: false,
  error: null,
};
const MAX_AUDIO_BYTES = 512 * 1024;
// Matches the server's DEEPGRAM_AUDIO_BYTE_LIMIT for one spoken reply.
const MAX_REPLY_AUDIO_BYTES = 1024 * 1024;
const AUDIO_FAILED = "The audio reply could not play. Its text is saved.";
const MAX_RECORDING_MS = 30_000;
const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
];
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The voice turn could not finish. Please try again.";
}
async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

/** Browser push-to-talk capture; provider credentials and transcript saves stay on the server. */
export class DeepgramVoiceController {
  private snapshot: VoiceSnapshot & { canContinueByText: boolean } = {
    ...initial,
    canContinueByText: false,
  };
  private listeners = new Set<() => void>();
  private active?: Session;
  private talkRequested = false;
  private epoch = 0;
  private requests = new Set<AbortController>();
  // Retain the exact request for a failed save/network response. Retrying its ID
  // lets the server recover a completed stage without repeating a saved message.
  private unsaved = new Map<string, Turn>();
  constructor(private dependencies: DeepgramVoiceDependencies) {}
  getSnapshot = () => this.snapshot;
  canContinueByText = () => {
    // A fresh controller has no recoverable recording. Avoid compiling Cedar's
    // browser-only context during server rendering of navigation controls.
    if (this.unsaved.size === 0) return false;
    const scope = this.dependencies.scope();
    const turn = this.unsaved.get(scope.threadId);
    return Boolean(
      turn?.failed &&
      !turn.pending &&
      turn.resourceId === scope.resourceId &&
      (!this.active ||
        (this.sameScope(this.active) &&
          !this.active.pendingTurn &&
          !this.active.stopPromise)),
    );
  };
  // Only an explicit user choice releases a failed recording's retry latch.
  // Never cancel an in-flight save: it may still return a persisted transcript.
  continueByText = async () => {
    if (!this.canContinueByText())
      throw new Error(
        "Wait for the voice turn to finish before continuing by text.",
      );
    const scope = this.dependencies.scope();
    this.unsaved.delete(scope.threadId);
    if (this.active) this.cleanup(this.active);
    this.update({ error: null });
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<VoiceSnapshot>) {
    const next = { ...patch, canContinueByText: this.canContinueByText() };
    if (
      Object.entries(next).every(
        ([key, value]) =>
          this.snapshot[key as keyof typeof this.snapshot] === value,
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((listener) => listener());
  }
  private sameScope(active: Pick<Session, "threadId" | "resourceId">) {
    const scope = this.dependencies.scope();
    return (
      scope.threadId === active.threadId &&
      scope.resourceId === active.resourceId
    );
  }
  private disableMicrophone(active: Session) {
    active.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }
  private clearPlayback(active: Session) {
    active.speech?.abort();
    active.speech = undefined;
    void active.audioReader?.cancel().catch(() => {});
    active.audioReader = undefined;
    if (active.audio) {
      active.audio.onplaying = null;
      active.audio.onpause = null;
      active.audio.onended = null;
      active.audio.onerror = null;
      active.audio.pause();
      active.audio.removeAttribute("src");
      active.audio.load();
      active.audio = undefined;
    }
    if (active.audioURL) URL.revokeObjectURL(active.audioURL);
    active.audioURL = undefined;
    if (this.active === active)
      this.update({ speaking: false, playbackBlocked: false });
  }
  private cleanup(active: Session) {
    this.disableMicrophone(active);
    active.microphone?.getTracks().forEach((track) => track.stop());
    this.clearPlayback(active);
    if (this.active !== active) return;
    this.active = undefined;
    this.talkRequested = false;
    this.update({
      status: "idle",
      muted: true,
      speaking: false,
      working: false,
      playbackBlocked: false,
    });
  }
  start = async (): Promise<void> => {
    if (this.active?.stopPromise) {
      await this.active.stopPromise.catch(() => {});
      return this.start();
    }
    if (this.active) {
      if (this.sameScope(this.active)) return;
      await this.stop().catch(() => {});
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      this.update({
        ...initial,
        error: "Voice needs a supported browser on HTTPS or localhost.",
      });
      return;
    }
    const scope = this.dependencies.scope();
    if (!scope.threadId || !scope.resourceId) {
      this.update({ ...initial, error: "Chat is still loading. Try again." });
      return;
    }
    this.active = {
      threadId: scope.threadId,
      resourceId: scope.resourceId,
    };
    // No provider connection or background recording is needed for this path.
    // Ask for microphone permission only while the user is holding to talk.
    this.update({ ...initial, status: "connected" });
  };
  private async acquireMicrophone(active: Session) {
    if (active.microphone) return;
    if (active.acquiring) return active.acquiring;
    const acquiring = (async () => {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      microphone.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      if (this.active !== active || active.stopPromise) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      active.microphone = microphone;
    })();
    active.acquiring = acquiring;
    try {
      await acquiring;
    } finally {
      if (active.acquiring === acquiring) active.acquiring = undefined;
    }
  }
  beginTalking = async () => {
    if (this.snapshot.status === "closing") return;
    const current = this.active;
    if (current?.pendingTurn) {
      this.update({
        error: "Voice is finishing your previous turn. Please wait.",
      });
      return;
    }
    this.talkRequested = true;
    if (!current || !this.sameScope(current)) await this.start();
    const active = this.active;
    if (!active || !this.talkRequested || active.stopPromise) return;
    if (active.capture) return;
    try {
      const unsaved = this.unsaved.get(active.threadId);
      if (unsaved)
        await this.runTurn(active, () => this.sendTurn(active, unsaved));
      if (this.active !== active || !this.talkRequested || active.stopPromise)
        return;
      this.update({ status: "connecting", error: null });
      await this.acquireMicrophone(active);
      if (this.active !== active || active.stopPromise) return;
      this.update({ status: "connected" });
      if (!this.talkRequested || !active.microphone || active.capture) return;
      if (!this.sameScope(active)) {
        await this.stop();
        return;
      }
      const mimeType = MIME_TYPES.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType)
        throw new Error("This browser cannot record a supported voice format.");
      const recorder = new MediaRecorder(active.microphone, {
        mimeType,
        audioBitsPerSecond: 64_000,
      });
      let resolve!: (blob: Blob) => void;
      let reject!: (error: Error) => void;
      const capture: Capture = {
        recorder,
        scope: this.dependencies.scope(),
        chunks: [],
        bytes: 0,
        done: new Promise<Blob>((done, failed) => {
          resolve = done;
          reject = failed;
        }),
        reject: (error) => reject(error),
      };
      // A recorder error can happen before a release event starts awaiting it.
      void capture.done.catch(() => {});
      recorder.ondataavailable = ({ data }) => {
        if (this.active !== active || active.capture !== capture || !data.size)
          return;
        capture.bytes += data.size;
        if (capture.bytes > MAX_AUDIO_BYTES) {
          capture.error = new Error(
            "This recording is too large. Hold to talk again for a shorter turn.",
          );
          this.endTalking();
          return;
        }
        capture.chunks.push(data);
      };
      recorder.onerror = () => {
        capture.error = new Error(
          "The microphone recording failed. Please try again.",
        );
        this.endTalking();
      };
      recorder.onstop = () => {
        clearTimeout(capture.timeout);
        if (capture.error) reject(capture.error);
        else
          resolve(
            new Blob(capture.chunks, { type: recorder.mimeType || mimeType }),
          );
      };
      this.clearPlayback(active);
      active.capture = capture;
      active.microphone.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      try {
        recorder.start(250);
      } catch (error) {
        active.capture = undefined;
        this.disableMicrophone(active);
        reject(
          error instanceof Error
            ? error
            : new Error("Recording could not start."),
        );
        throw error;
      }
      capture.timeout = setTimeout(() => {
        if (active.capture !== capture) return;
        this.update({
          error:
            "Recording stopped at 30 seconds. Your turn is being processed.",
        });
        this.endTalking();
      }, MAX_RECORDING_MS);
      this.update({ muted: false, error: null });
    } catch (error) {
      if (this.active !== active || active.stopPromise) return;
      this.talkRequested = false;
      this.disableMicrophone(active);
      this.update({ status: "connected", muted: true, error: message(error) });
    }
  };
  private runTurn(active: Session, operation: () => Promise<void>) {
    if (active.pendingTurn) return active.pendingTurn;
    this.update({ working: true, muted: true });
    const pending = operation()
      .catch((error) => {
        if (this.active === active) this.update({ error: message(error) });
        throw error;
      })
      .finally(() => {
        if (active.pendingTurn === pending) active.pendingTurn = undefined;
        if (this.active === active) this.update({ working: false });
      });
    active.pendingTurn = pending;
    return pending;
  }
  private finishRecording(active: Session) {
    if (active.pendingTurn) return active.pendingTurn;
    const capture = active.capture;
    if (!capture) return Promise.resolve();
    this.disableMicrophone(active);
    clearTimeout(capture.timeout);
    const pending = this.runTurn(active, async () => {
      const blob = await capture.done;
      if (this.active !== active || !blob.size) return;
      if (blob.size > MAX_AUDIO_BYTES)
        throw new Error(
          "This recording is too large. Please record a shorter turn.",
        );
      const scope = this.sameScope(active)
        ? this.dependencies.scope()
        : capture.scope;
      const turn: Turn = {
        epoch: this.epoch,
        resourceId: active.resourceId,
        body: {
          turnId: crypto.randomUUID(),
          threadId: active.threadId,
          audioBase64: await base64(blob),
          mimeType: blob.type,
          context: scope.context,
          messages: this.dependencies.messages(active.threadId).slice(-128),
        },
      };
      if (this.active !== active || turn.epoch !== this.epoch) return;
      this.unsaved.set(active.threadId, turn);
      await this.sendTurn(active, turn);
    });
    try {
      if (capture.recorder.state !== "inactive") capture.recorder.stop();
    } catch (error) {
      capture.error =
        error instanceof Error
          ? error
          : new Error("Recording could not finish.");
      capture.reject(capture.error);
      // A failed stop cannot produce a trustworthy final chunk.
      this.update({ error: message(capture.error) });
    }
    void pending
      .finally(() => {
        if (active.capture === capture) active.capture = undefined;
        capture.recorder.ondataavailable = null;
        capture.recorder.onerror = null;
        capture.recorder.onstop = null;
      })
      .catch(() => {});
    return pending;
  }
  endTalking = () => {
    this.talkRequested = false;
    const active = this.active;
    if (!active) return;
    this.disableMicrophone(active);
    this.update({ muted: true });
    if (active.capture) void this.finishRecording(active).catch(() => {});
  };
  private sendTurn(active: Session | undefined, turn: Turn) {
    if (turn.pending) return turn.pending;
    const pending = this.performTurn(active, turn).finally(() => {
      if (turn.pending === pending) turn.pending = undefined;
      this.update({});
    });
    turn.pending = pending;
    this.update({});
    return pending;
  }
  private async performTurn(active: Session | undefined, turn: Turn) {
    if (turn.epoch !== this.epoch) return;
    turn.failed = false;
    const abort = new AbortController();
    this.requests.add(abort);
    try {
      const response = await fetch(
        this.dependencies.baseURL().replace(/\/$/, "") + "/voice/deepgram/turn",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: (turn.serializedBody ??= JSON.stringify(turn.body)),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]),
        },
      );
      if (turn.epoch !== this.epoch || abort.signal.aborted) return;
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (turn.epoch !== this.epoch || abort.signal.aborted) return;
        // A rejected clip (including silence) has no saved transcript to recover.
        // Let the next press create a fresh clip instead of replaying bad audio.
        if (
          [400, 413, 415, 422].includes(response.status) &&
          this.unsaved.get(turn.body.threadId) === turn
        )
          this.unsaved.delete(turn.body.threadId);
        throw new Error(
          result.error || "The voice request failed. Please try again.",
        );
      }
      const sessionId = "deepgram-" + turn.body.turnId;
      const invalid = new Error(
        "The voice server returned an invalid response. Please try again.",
      );
      const reader = response.body?.getReader();
      if (!reader) throw invalid;
      // NDJSON: each saved message, then one done (or error) line.
      const decoder = new TextDecoder();
      const transcript: ReturnType<VoiceTranscript["messages"]> = [];
      let buffered = "";
      let result: Record<string, unknown> | undefined;
      try {
        while (!result) {
          const chunk = await reader.read();
          if (turn.epoch !== this.epoch || abort.signal.aborted) return;
          buffered += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = buffered.split("\n");
          buffered = chunk.done ? "" : lines.pop()!;
          for (const line of lines) {
            if (!line.trim() || result) continue;
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              throw invalid;
            }
            if (event?.type === "error")
              throw new Error(
                typeof event.error === "string" && event.error
                  ? event.error
                  : "The voice request failed. Please try again.",
              );
            if (event?.type === "done") {
              result = event;
              continue;
            }
            const item = event?.type === "message" ? event.message : undefined;
            if (
              !item ||
              (item.role !== "user" && item.role !== "assistant") ||
              item.id !== "voice-" + sessionId + "-" + item.role ||
              typeof item.content !== "string" ||
              !item.content.trim() ||
              typeof item.createdAt !== "string" ||
              !Number.isFinite(Date.parse(item.createdAt))
            )
              throw new Error(
                "The voice server returned an invalid transcript. Please try again.",
              );
            transcript.push({
              id: item.id,
              role: item.role,
              content: item.content,
              createdAt: item.createdAt,
              metadata: {
                source: "live-voice",
                sessionId,
                voiceProvider: "deepgram",
                fragments: [],
              },
            });
            // Replaces this turn's messages: the user's words show before Bart replies.
            this.dependencies.transcript(turn.body.threadId, sessionId, [
              ...transcript,
            ]);
          }
          if (chunk.done) break;
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      if (!result)
        throw new Error("The voice request failed. Please try again.");
      if (
        result.sessionId !== sessionId ||
        (result.status !== "success" && result.status !== "partial") ||
        typeof result.persisted !== "boolean"
      )
        throw invalid;
      const error = typeof result.error === "string" ? result.error : "";
      if (!result.persisted)
        throw new Error(
          error || "Could not save the voice transcript. Please try again.",
        );
      if (!transcript.some((item) => item.role === "user"))
        throw new Error(
          "The voice server returned no saved transcript. Please try again.",
        );
      if (this.unsaved.get(turn.body.threadId) === turn)
        this.unsaved.delete(turn.body.threadId);
      if (active && this.active === active) {
        this.update({ error: error || null });
        // Not awaited: the turn ends with Bart's text; `speaking` covers the audio.
        if (
          this.sameScope(active) &&
          !active.stopPromise &&
          result.status === "success" &&
          transcript.some((item) => item.role === "assistant")
        )
          void this.speak(active, turn.body);
      }
    } catch (error) {
      if (
        turn.epoch === this.epoch &&
        this.unsaved.get(turn.body.threadId) === turn
      ) {
        turn.failed = true;
        const failure = new Error(
          message(error) +
            " Hold the microphone to retry, or select Continue by text to discard this recording. Saved messages will be kept.",
        );
        if (
          this.sameScope({
            threadId: turn.body.threadId,
            resourceId: turn.resourceId,
          })
        )
          this.update({ error: failure.message });
        throw failure;
      }
      throw error;
    } finally {
      this.requests.delete(abort);
    }
  }
  private async speak(active: Session, { turnId, threadId }: Turn["body"]) {
    this.clearPlayback(active);
    const abort = new AbortController();
    active.speech = abort;
    this.requests.add(abort);
    // Resolves on the event, or at once when this playback is cleared.
    const settle = (target: EventTarget, type: string) =>
      new Promise<void>((resolve) => {
        const done = () => {
          target.removeEventListener(type, done);
          abort.signal.removeEventListener("abort", done);
          resolve();
        };
        target.addEventListener(type, done);
        abort.signal.addEventListener("abort", done);
      });
    try {
      const response = await fetch(
        this.dependencies.baseURL().replace(/\/$/, "") + "/voice/deepgram/speech",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnId, threadId }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]),
        },
      );
      if (abort.signal.aborted) return;
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          typeof result.error === "string" && result.error
            ? result.error
            : AUDIO_FAILED,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error(AUDIO_FAILED);
      active.audioReader = reader;
      let bytes = 0;
      const read = async () => {
        const chunk = await reader.read();
        bytes += chunk.value?.byteLength ?? 0;
        if (bytes > MAX_REPLY_AUDIO_BYTES)
          throw new Error(
            "The audio reply is too large to play. Its text is saved.",
          );
        return chunk;
      };
      if (
        typeof MediaSource !== "undefined" &&
        MediaSource.isTypeSupported("audio/mpeg")
      ) {
        // Progressive: play once the first chunk is buffered (~0.3 s), not after the whole reply.
        const audio = new Audio();
        const source = new MediaSource();
        this.watchPlayback(active, audio, URL.createObjectURL(source));
        await settle(source, "sourceopen");
        if (abort.signal.aborted) return;
        const buffer = source.addSourceBuffer("audio/mpeg");
        let started = false;
        while (true) {
          const chunk = await read();
          if (abort.signal.aborted) return;
          if (chunk.done) break;
          buffer.appendBuffer(chunk.value);
          await settle(buffer, "updateend");
          if (abort.signal.aborted) return;
          if (!started) void this.startPlayback(active, audio);
          started = true;
        }
        source.endOfStream();
      } else {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        for (let chunk = await read(); !chunk.done; chunk = await read())
          chunks.push(chunk.value);
        if (abort.signal.aborted) return;
        const audio = new Audio();
        this.watchPlayback(
          active,
          audio,
          URL.createObjectURL(new Blob(chunks, { type: "audio/mpeg" })),
        );
        await this.startPlayback(active, audio);
      }
    } catch (error) {
      if (abort.signal.aborted || this.active !== active) return;
      this.clearPlayback(active);
      // Our own errors are user-facing; network and media exceptions are not.
      this.update({
        error:
          error instanceof Error && error.name === "Error"
            ? error.message
            : AUDIO_FAILED,
      });
    } finally {
      this.requests.delete(abort);
      if (active.speech === abort) {
        active.speech = undefined;
        active.audioReader = undefined;
      }
    }
  }
  private watchPlayback(active: Session, audio: HTMLAudioElement, url: string) {
    active.audio = audio;
    active.audioURL = url;
    audio.src = url;
    audio.onplaying = () => {
      if (this.active === active && active.audio === audio)
        this.update({
          speaking: !audio.paused && !audio.muted,
          playbackBlocked: false,
        });
    };
    const quiet = () => {
      if (this.active === active && active.audio === audio)
        this.update({ speaking: false });
    };
    audio.onpause = quiet;
    audio.onended = () => {
      quiet();
      if (active.audio === audio) this.clearPlayback(active);
    };
    audio.onerror = () => {
      if (this.active === active && active.audio === audio) {
        this.clearPlayback(active);
        this.update({ error: AUDIO_FAILED });
      }
    };
  }
  private async startPlayback(active: Session, audio: HTMLAudioElement) {
    try {
      await audio.play();
    } catch {
      if (this.active === active && active.audio === audio)
        this.update({ speaking: false, playbackBlocked: true });
    }
  }
  resumePlayback = async () => {
    const active = this.active;
    const audio = active?.audio;
    if (!active || !audio || active.stopPromise) return;
    try {
      await audio.play();
      if (this.active === active && active.audio === audio)
        this.update({ playbackBlocked: false });
    } catch {
      if (this.active === active)
        this.update({
          error:
            "Audio playback is blocked. Allow audio in your browser and try again.",
        });
    }
  };
  private async flushSession(active?: Session) {
    if (active?.pendingTurn) {
      await active.pendingTurn;
      return;
    }
    const scope = this.dependencies.scope();
    const threadId = active?.threadId ?? scope.threadId;
    const turn = this.unsaved.get(threadId);
    if (!turn) return;
    if (turn.resourceId !== (active?.resourceId ?? scope.resourceId))
      throw new Error("The voice turn belongs to a different conversation.");
    if (active) await this.runTurn(active, () => this.sendTurn(active, turn));
    else await this.sendTurn(undefined, turn);
  }
  flush = async () => {
    this.endTalking();
    await this.flushSession(this.active);
  };
  stop = () => {
    this.talkRequested = false;
    const active = this.active;
    if (!active) return this.flushSession();
    if (active.stopPromise) return active.stopPromise;
    this.endTalking();
    this.update({ status: "closing" });
    active.stopPromise = (async () => {
      try {
        await this.flushSession(active);
      } finally {
        this.cleanup(active);
      }
    })();
    return active.stopPromise;
  };
  // Each submitted recording reads the latest context and typed history. There is
  // no open remote session to mutate while a different typed turn is running.
  syncContext() {}
  syncTypedMessages() {}
  dispose = () => {
    this.epoch++;
    this.talkRequested = false;
    this.requests.forEach((abort) => abort.abort());
    this.requests.clear();
    this.unsaved.clear();
    const active = this.active;
    if (!active) return;
    const capture = active.capture;
    if (capture) {
      clearTimeout(capture.timeout);
      // Keep onstop until the recorder's final event settles its pending promise;
      // the epoch/current-session guards discard every late chunk and response.
      if (capture.recorder.state !== "inactive") {
        try {
          capture.recorder.stop();
        } catch {
          /* Tracks are stopped below. */
        }
      }
    }
    this.cleanup(active);
  };
}
