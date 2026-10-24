import {
  VoiceTranscript,
  voiceContextChunks,
  type ConversationMessage,
} from "./voiceTranscript";

export type VoiceStatus = "idle" | "connecting" | "connected" | "closing";
export type VoiceSnapshot = {
  status: VoiceStatus;
  muted: boolean;
  speaking: boolean;
  working: boolean;
  playbackBlocked: boolean;
  error: string | null;
};
type Scope = {
  threadId: string;
  resourceId: string;
  context: Record<string, unknown>;
  messages: ConversationMessage[];
};
type Dependencies = {
  baseURL: () => string;
  scope: () => Scope;
  messages: (threadId: string) => ConversationMessage[];
  transcript: (
    threadId: string,
    sessionId: string,
    messages: ReturnType<VoiceTranscript["messages"]>,
  ) => void;
};
type ActiveSession = {
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  abort: AbortController;
  threadId: string;
  resourceId: string;
  startedAt: number;
  microphone?: MediaStream;
  audio: HTMLAudioElement;
  analyser?: AudioContext;
  frame?: number;
  syncTimer?: ReturnType<typeof setTimeout>;
  readyTimer?: ReturnType<typeof setTimeout>;
  sessionId?: string;
  token?: string;
  transcript?: VoiceTranscript;
  seen: Set<string>;
  delegated: Set<string>;
  pendingDelegations: Map<string, ReturnType<typeof setTimeout>>;
  revision: number;
  runningDelegations: number;
  syncQueue: Promise<void>;
  ready: boolean;
  contextKey: string;
  closed?: (error?: Error) => void;
  stopPromise?: Promise<void>;
  readyResolve?: () => void;
};
const initial: VoiceSnapshot = {
  status: "idle",
  muted: true,
  speaking: false,
  working: false,
  playbackBlocked: false,
  error: null,
};

export class LiveVoiceController {
  private snapshot: VoiceSnapshot = initial;
  private listeners = new Set<() => void>();
  private active?: ActiveSession;
  private interruptedSave?: ActiveSession;
  private talkRequested = false;
  constructor(private dependencies: Dependencies) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<VoiceSnapshot>) {
    if (
      Object.entries(patch).every(
        ([key, value]) => this.snapshot[key as keyof VoiceSnapshot] === value,
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private send(active: ActiveSession, event: Record<string, unknown>) {
    if (this.active !== active || active.channel.readyState !== "open") return;
    active.channel.send(
      JSON.stringify({ event_id: crypto.randomUUID(), ...event }),
    );
  }
  private async request(
    path: string,
    body: unknown,
    active: ActiveSession,
    timeout = 45000,
  ) {
    const response = await fetch(
      this.dependencies.baseURL().replace(/\/$/, "") + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(active.token ? { Authorization: "Bearer " + active.token } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          active.abort.signal,
          AbortSignal.timeout(timeout),
        ]),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        result.error || "Voice request failed (HTTP " + response.status + ").",
      );
    return result;
  }
  private cleanup(active: ActiveSession) {
    const current = this.active === active;
    if (current) {
      this.active = undefined;
      this.talkRequested = false;
    }
    clearTimeout(active.syncTimer);
    clearTimeout(active.readyTimer);
    active.pendingDelegations.forEach(clearTimeout);
    active.readyResolve?.();
    active.abort.abort();
    active.microphone?.getTracks().forEach((track) => track.stop());
    active.audio.pause();
    active.audio.srcObject = null;
    if (active.frame !== undefined) cancelAnimationFrame(active.frame);
    void active.analyser?.close().catch(() => {});
    active.channel.close();
    active.peer.close();
    if (current)
      this.update({
        status: "idle",
        muted: true,
        speaking: false,
        working: false,
        playbackBlocked: false,
      });
  }
  private fail(active: ActiveSession, error: unknown) {
    if (this.active !== active) return;
    this.update({
      error:
        error instanceof Error
          ? error.message
          : "Voice connection failed. Please reconnect.",
    });
    active.closed?.(
      error instanceof Error
        ? error
        : new Error("Voice disconnected before finalization."),
    );
    if (active.token) {
      // A media disconnect does not invalidate the server's transcript capability.
      // Save the last captions with a fresh request signal after closing media.
      this.interruptedSave = {
        ...active,
        abort: new AbortController(),
        syncQueue: Promise.resolve(),
      };
      void this.sync(this.interruptedSave).catch(() => {});
    }
    // Retain captions locally even when saving or finalization is impossible.
    this.cleanup(active);
  }
  start = async (): Promise<void> => {
    // A chat can mount while the previous conversation is still finalizing.
    // Reconnect after that save completes rather than dropping the startup request.
    if (this.active?.stopPromise) {
      await this.active.stopPromise.catch(() => {});
      return this.start();
    }
    if (this.active) return;
    this.update({ ...initial, status: "connecting" });
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      this.update({
        status: "idle",
        error: "Voice needs a supported browser on HTTPS or localhost.",
      });
      return;
    }
    const scope = this.dependencies.scope();
    if (!scope.threadId || !scope.resourceId) {
      this.update({
        status: "idle",
        error: "Chat is still loading. Try again.",
      });
      return;
    }
    const peer = new RTCPeerConnection();
    const active: ActiveSession = {
      peer,
      channel: peer.createDataChannel("oai-events"),
      abort: new AbortController(),
      threadId: scope.threadId,
      resourceId: scope.resourceId,
      startedAt: Date.now(),
      audio: new Audio(),
      seen: new Set(
        scope.messages.map((message) => message.id + ":" + message.content),
      ),
      delegated: new Set(),
      pendingDelegations: new Map(),
      revision: 0,
      runningDelegations: 0,
      syncQueue: Promise.resolve(),
      ready: false,
      contextKey: JSON.stringify(scope.context),
    };
    this.active = active;
    active.audio.autoplay = true;
    peer.ontrack = ({ track }) => {
      if (this.active !== active) {
        track.stop();
        return;
      }
      active.audio.srcObject = new MediaStream([track]);
      void active.audio.play().catch(() => {
        if (this.active === active) this.update({ playbackBlocked: true });
      });
      // Audio generation and transcript delivery do not indicate actual playback.
      try {
        active.analyser = new AudioContext();
        const source = active.analyser.createMediaStreamSource(
          active.audio.srcObject as MediaStream,
        );
        const analyser = active.analyser.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let lastAudibleAt = -Infinity;
        const monitor = () => {
          if (this.active !== active) return;
          analyser.getByteTimeDomainData(samples);
          const loud = samples.some((sample) => Math.abs(sample - 128) > 3);
          const playing = !active.audio.paused && !active.audio.muted;
          const now = performance.now();
          if (!playing) lastAudibleAt = -Infinity;
          else if (loud) lastAudibleAt = now;
          // Keep the indicator through word and sentence pauses, but clear it
          // promptly when playback is paused, muted, or the session ends.
          this.update({
            speaking: playing && now - lastAudibleAt < 800,
          });
          active.frame = requestAnimationFrame(monitor);
        };
        monitor();
      } catch {
        /* Audio playback still works without a level meter. */
      }
    };
    peer.onconnectionstatechange = () => {
      if (this.active !== active) return;
      if (
        peer.connectionState === "failed" ||
        peer.connectionState === "disconnected"
      )
        this.fail(
          active,
          new Error(
            "Voice disconnected. Your transcript is preserved; reconnect to continue.",
          ),
        );
    };
    active.channel.onmessage = ({ data }) => {
      if (this.active !== active) return;
      try {
        this.onEvent(active, JSON.parse(data));
      } catch {
        this.fail(active, new Error("Received an invalid voice event."));
      }
    };
    active.channel.onclose = () => {
      if (this.active === active && !active.stopPromise)
        this.fail(
          active,
          new Error(
            "Voice connection closed before finalization. Your transcript is preserved.",
          ),
        );
    };
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.active !== active) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      active.microphone = microphone;
      // Setup can outlive a press. Keep capture muted until the connection is
      // ready and the key or microphone button is still held.
      microphone.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      microphone
        .getAudioTracks()
        .forEach((track) => peer.addTrack(track, microphone));
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          peer.removeEventListener("icegatheringstatechange", check);
          reject(new Error("Voice connection timed out during setup."));
        }, 10000);
        const check = () => {
          if (peer.iceGatheringState === "complete" || this.active !== active) {
            clearTimeout(timeout);
            peer.removeEventListener("icegatheringstatechange", check);
            resolve();
          }
        };
        peer.addEventListener("icegatheringstatechange", check);
        check();
      });
      if (this.active !== active) return;
      const result = await this.request(
        "/voice/session",
        {
          ...scope,
          messages: scope.messages.slice(-128),
          sdp: peer.localDescription?.sdp,
        },
        active,
        35000,
      );
      if (this.active !== active) return;
      active.sessionId = result.sessionId;
      active.token = result.token;
      active.transcript = new VoiceTranscript(
        result.sessionId,
        active.startedAt,
      );
      await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
      await new Promise<void>((resolve, reject) => {
        active.readyResolve = resolve;
        active.readyTimer = setTimeout(
          () =>
            reject(
              new Error(
                "OpenAI did not start the voice session. Please reconnect.",
              ),
            ),
          20000,
        );
        if (active.ready) resolve();
      });
      clearTimeout(active.readyTimer);
    } catch (error) {
      this.fail(active, error);
    }
  };
  private onEvent(active: ActiveSession, event: Record<string, any>) {
    if (event.type === "session.started") {
      if (!active.ready) {
        active.startedAt = Date.now();
        active.transcript = new VoiceTranscript(
          active.sessionId!,
          active.startedAt,
        );
      }
      active.ready = true;
      active.readyResolve?.();
      this.update({ status: "connected" });
      this.applyTalkIntent();
      this.syncContext();
      return;
    }
    if (event.type === "error") {
      this.update({
        error:
          "OpenAI Voice: " +
          (event.error?.message || "The session reported an error."),
      });
      return;
    }
    if (event.type === "session.closed") {
      if (active.closed) active.closed();
      else {
        this.update({ error: "Voice session ended. Reconnect to continue." });
        void this.sync(active)
          .catch(() => {})
          .finally(() => this.cleanup(active));
      }
      return;
    }
    if (
      event.type === "session.input_transcript.delta" ||
      event.type === "session.output_transcript.delta"
    ) {
      if (
        typeof event.delta !== "string" ||
        typeof event.event_id !== "string" ||
        !Number.isFinite(event.start_ms) ||
        !Number.isFinite(event.end_ms)
      )
        return;
      const role =
        event.type === "session.input_transcript.delta" ? "user" : "assistant";
      if (
        !active.transcript?.append({
          event_id: event.event_id,
          role,
          delta: event.delta,
          start_ms: event.start_ms,
          end_ms: event.end_ms,
        })
      )
        return;
      if (role === "user") active.revision++;
      this.dependencies.transcript(
        active.threadId,
        active.sessionId!,
        active.transcript.messages(),
      );
      if (!active.syncTimer && !active.stopPromise)
        active.syncTimer = setTimeout(() => {
          active.syncTimer = undefined;
          void this.sync(active).catch((error) => {
            if (this.active === active)
              this.update({
                error: "Could not save voice history: " + error.message,
              });
          });
        }, 2000);
      for (const [id, timer] of active.pendingDelegations) {
        clearTimeout(timer);
        this.scheduleDelegation(active, id);
      }
    }
    if (
      event.type === "session.delegation.created" &&
      event.delegation?.target === "client" &&
      typeof event.delegation.id === "string" &&
      !active.stopPromise
    ) {
      this.scheduleDelegation(active, event.delegation.id);
    }
  }
  private scheduleDelegation(active: ActiveSession, id: string) {
    if (active.delegated.has(id) || active.stopPromise) return;
    // Delegation can arrive before the corresponding transcript. Allow captions
    // to settle; this delay does not claim that a speech turn is complete.
    clearTimeout(active.pendingDelegations.get(id));
    active.pendingDelegations.set(
      id,
      setTimeout(() => {
        active.pendingDelegations.delete(id);
        void this.delegate(active, id);
      }, 650),
    );
  }
  private async delegate(active: ActiveSession, id: string) {
    if (this.active !== active || !active.ready || active.stopPromise) return;
    active.delegated.add(id);
    const revision = active.revision;
    active.runningDelegations++;
    this.update({ working: true });
    try {
      const scope = this.dependencies.scope();
      const result = await this.request(
        "/voice/delegate",
        {
          sessionId: active.sessionId,
          delegationId: id,
          context: scope.context,
          messages: this.dependencies.messages(active.threadId).slice(-128),
        },
        active,
      );
      if (this.active !== active || active.stopPromise) return;
      if (active.revision !== revision) {
        this.send(active, {
          type: "session.thinking.append",
          delegation_id: id,
          content:
            "The user added or corrected their request while the backend worked. The previous draft was discarded. Delegate again using the latest conversation.",
        });
        return;
      }
      // The backend caps drafts at 250 output tokens, below Live's 500-token
      // append limit. Deliver each draft atomically so it can be spoken coherently.
      this.send(active, {
        type: "session.commentary.append",
        delegation_id: id,
        content: result.text,
      });
    } catch (error) {
      if (this.active !== active || active.stopPromise) return;
      this.update({
        error:
          error instanceof Error
            ? error.message
            : "The voice backend failed. Try again.",
      });
      this.send(active, {
        type: "session.commentary.append",
        delegation_id: id,
        content:
          "The backend could not retrieve the requested information. Ask the user to try again; do not invent an answer.",
      });
    } finally {
      active.runningDelegations--;
      if (this.active === active)
        this.update({ working: active.runningDelegations > 0 });
    }
  }
  private sync(active: ActiveSession) {
    if (!active.token) return Promise.resolve();
    const messages = this.dependencies
      .messages(active.threadId)
      .filter((message) =>
        message.id.startsWith("voice-" + active.sessionId + "-"),
      );
    // Serialize saves so an older partial caption cannot overwrite its final text.
    active.syncQueue = active.syncQueue
      .catch(() => {})
      .then(async () => {
        for (let offset = 0; offset < messages.length; offset += 128) {
          await this.request(
            "/voice/sync",
            {
              sessionId: active.sessionId,
              messages: messages.slice(offset, offset + 128),
            },
            active,
            15000,
          );
        }
      });
    return active.syncQueue;
  }
  stop = () => {
    this.talkRequested = false;
    const active = this.active;
    if (!active) return Promise.resolve();
    if (active.stopPromise) return active.stopPromise;
    this.update({ status: "closing" });
    active.microphone?.getTracks().forEach((track) => {
      track.enabled = false;
    });
    active.audio.muted = true;
    clearTimeout(active.syncTimer);
    active.pendingDelegations.forEach(clearTimeout);
    active.pendingDelegations.clear();
    active.stopPromise = (async () => {
      try {
        if (active.ready && active.channel.readyState === "open") {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    "Voice finalization timed out. The transcript may be incomplete.",
                  ),
                ),
              15000,
            );
            active.closed = (error) => {
              clearTimeout(timeout);
              if (error) reject(error);
              else resolve();
            };
            this.send(active, { type: "session.close" });
          });
        }
        await this.sync(active);
      } catch (error) {
        await this.sync(active).catch(() => {});
        this.update({
          error:
            error instanceof Error
              ? error.message
              : "Could not finish the voice conversation.",
        });
        throw error;
      } finally {
        this.cleanup(active);
      }
    })();
    return active.stopPromise;
  };
  private applyTalkIntent() {
    const active = this.active;
    if (!active || !active.ready || this.snapshot.status !== "connected")
      return;
    const muted = !this.talkRequested;
    if (muted === this.snapshot.muted) return;
    active.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    // Local capture is authoritative; the service command also controls its buffer.
    this.send(active, {
      type: muted ? "session.input_audio.mute" : "session.input_audio.unmute",
    });
    this.update({ muted });
  }
  beginTalking = async () => {
    if (this.snapshot.status === "closing") return;
    this.talkRequested = true;
    if (!this.active) await this.start();
    else this.applyTalkIntent();
  };
  endTalking = () => {
    this.talkRequested = false;
    this.active?.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    this.applyTalkIntent();
  };
  flush = async () => {
    try {
      if (this.interruptedSave) {
        await this.sync(this.interruptedSave);
        this.interruptedSave = undefined;
      }
      if (!this.active) return;
      await this.sync(this.active);
    } catch (error) {
      this.update({
        error:
          "Could not save the voice transcript before sending your message. Please try again.",
      });
      throw error;
    }
  };
  resumePlayback = async () => {
    const active = this.active;
    if (!active) return;
    try {
      await active.audio.play();
      await active.analyser?.resume();
      this.update({ playbackBlocked: false });
    } catch {
      this.update({
        error:
          "Audio playback is blocked. Allow audio in your browser and try again.",
      });
    }
  };
  syncTypedMessages() {
    const active = this.active;
    if (!active?.ready || active.stopPromise) return;
    for (const message of this.dependencies.messages(active.threadId)) {
      if (message.id.startsWith("voice-")) continue;
      const key = message.id + ":" + message.content;
      if (active.seen.has(key)) continue;
      active.seen.add(key);
      active.revision++;
      for (const content of voiceContextChunks(
        "Typed " + message.role + " message: " + message.content,
      )) {
        this.send(active, {
          type: "session.thinking.append",
          delegation_id: null,
          content,
        });
      }
    }
  }
  syncContext() {
    const active = this.active;
    if (!active?.ready || active.stopPromise) return;
    const contextKey = JSON.stringify(this.dependencies.scope().context);
    if (contextKey === active.contextKey) return;
    active.contextKey = contextKey;
    active.revision++;
    this.send(active, {
      type: "session.instructions.append",
      delegation_id: null,
      content:
        "The scenario or selected document context has changed. Earlier details may be outdated. Delegate questions about the current scenario, documents, or feedback to the backend before answering them.",
    });
  }
  dispose = () => {
    if (this.active) {
      this.send(this.active, { type: "session.close" });
      this.active.closed?.(new Error("Voice closed before finalization."));
      this.cleanup(this.active);
    }
  };
}
