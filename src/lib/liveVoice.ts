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
  censorTail?: string;
  censorTone?: OscillatorNode;
  censorTimer?: ReturnType<typeof setTimeout>;
  syncTimer?: ReturnType<typeof setTimeout>;
  readyTimer?: ReturnType<typeof setTimeout>;
  leaseTimer?: ReturnType<typeof setTimeout>;
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
  cleaned?: boolean;
  releasePromise?: Promise<void>;
  recoveryPromise?: Promise<void>;
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
  private interruptedSaves = new Map<string, ActiveSession>();
  private talkRequested = false;
  // A synced video renderer may take over playback of Bart's voice. Direct
  // playback stays attached but muted, so analysis and recovery still work.
  private remoteTrack: MediaStreamTrack | null = null;
  private remoteAudioListeners = new Set<
    (track: MediaStreamTrack | null) => void
  >();
  private outputRouted = false;
  private censorListeners = new Set<() => void>();
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
  private setRemoteTrack(track: MediaStreamTrack | null) {
    if (this.remoteTrack === track) return;
    this.remoteTrack = track;
    this.remoteAudioListeners.forEach((listener) => listener(track));
  }
  /** Bart's remote voice track, now and whenever a new call replaces it. */
  subscribeRemoteAudio = (
    listener: (track: MediaStreamTrack | null) => void,
  ) => {
    this.remoteAudioListeners.add(listener);
    listener(this.remoteTrack);
    return () => {
      this.remoteAudioListeners.delete(listener);
    };
  };
  /**
   * Route Bart's voice to an external synced renderer (true) or back to direct
   * playback (false). Routing never unmutes a call that is closing.
   */
  routeOutput = (routed: boolean) => {
    this.outputRouted = routed;
    const active = this.active;
    if (active && !active.stopPromise)
      active.audio.muted = routed || Boolean(active.censorTone);
  };
  /**
   * Censor markers while a synced renderer plays Bart. It hears each word
   * later than the voice track, so it covers the word itself.
   */
  subscribeCensor = (listener: () => void) => {
    this.censorListeners.add(listener);
    return () => {
      this.censorListeners.delete(listener);
    };
  };
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
    options: { detached?: boolean; keepalive?: boolean } = {},
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
        signal: options.detached
          ? AbortSignal.timeout(timeout)
          : AbortSignal.any([
              active.abort.signal,
              AbortSignal.timeout(timeout),
            ]),
        ...(options.keepalive ? { keepalive: true } : {}),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        result.error || "Voice request failed (HTTP " + response.status + ").",
      );
    return result;
  }
  private censorBeep(active: ActiveSession) {
    if (this.active !== active || active.cleaned) return;
    if (this.outputRouted && this.censorListeners.size) {
      this.censorListeners.forEach((listener) => listener());
      return;
    }
    try {
      const context = active.analyser ?? (active.analyser = new AudioContext());
      void context.resume().catch(() => {});
      clearTimeout(active.censorTimer);
      if (!active.censorTone) {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.frequency.value = 1000;
        gain.gain.value = 0.12;
        tone.connect(gain);
        gain.connect(context.destination);
        tone.onended = () => gain.disconnect();
        active.censorTone = tone;
        active.audio.muted = true;
        tone.start();
      }
      active.censorTimer = setTimeout(() => {
        active.censorTone?.stop();
        active.censorTone?.disconnect();
        active.censorTone = undefined;
        if (this.active === active && !active.cleaned)
          active.audio.muted = this.outputRouted;
      }, 300);
    } catch {
      active.audio.muted = this.outputRouted;
      active.censorTone?.disconnect();
      active.censorTone = undefined;
      this.update({ error: "The censor beep could not play. Reconnect voice to try again." });
    }
  }
  private cleanup(active: ActiveSession) {
    if (active.cleaned) return;
    active.cleaned = true;
    const current = this.active === active;
    if (current) {
      this.active = undefined;
      this.talkRequested = false;
    }
    clearTimeout(active.censorTimer);
    active.censorTone?.stop();
    active.censorTone?.disconnect();
    active.censorTone = undefined;
    clearTimeout(active.syncTimer);
    clearTimeout(active.readyTimer);
    clearTimeout(active.leaseTimer);
    active.pendingDelegations.forEach(clearTimeout);
    active.readyResolve?.();
    active.abort.abort();
    active.microphone?.getTracks().forEach((track) => track.stop());
    active.audio.pause();
    active.audio.srcObject = null;
    if (current) this.setRemoteTrack(null);
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
  private release(active: ActiveSession) {
    if (!active.token) return Promise.resolve();
    // Keep this tiny request alive across pagehide, independently of the media
    // abort signal. Concurrent stop/dispose paths share one release request.
    if (!active.releasePromise)
      active.releasePromise = this.request(
        "/voice/end",
        { sessionId: active.sessionId },
        active,
        5000,
        { detached: true, keepalive: true },
      )
        .then(() => {})
        .catch((error) => {
          active.releasePromise = undefined;
          throw error;
        });
    return active.releasePromise;
  }
  private recover(active: ActiveSession, keepalive = false) {
    if (!active.token || !active.sessionId) return;
    this.interruptedSaves.set(active.sessionId, active);
    if (active.recoveryPromise) return;
    // The server retains the transcript capability after releasing the slot.
    // Saving and release can race safely, even when an unload loses one request.
    active.recoveryPromise = Promise.all([
      this.sync(active, keepalive),
      this.release(active),
    ])
      .then(() => {
        if (this.interruptedSaves.get(active.sessionId!) === active)
          this.interruptedSaves.delete(active.sessionId!);
      })
      .catch(() => {})
      .finally(() => {
        active.recoveryPromise = undefined;
      });
  }
  private renewLease(active: ActiveSession) {
    active.leaseTimer = setTimeout(() => {
      if (this.active !== active || active.stopPromise) return;
      void this.request(
        "/voice/heartbeat",
        { sessionId: active.sessionId },
        active,
        10000,
      )
        .then(() => {
          if (this.active === active && !active.stopPromise)
            this.renewLease(active);
        })
        .catch((error) => this.fail(active, error));
    }, 15000);
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
    // Retain captions locally even when saving or finalization is impossible.
    this.cleanup(active);
    this.recover(active);
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
      // Keep the element playing even when routed: Chrome only feeds a remote
      // WebRTC track to Web Audio while a media element is consuming it.
      active.audio.muted = this.outputRouted;
      this.setRemoteTrack(track);
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
          // The direct element is muted on purpose while a synced renderer plays
          // Bart (until the call starts closing) and while a censor tone covers him.
          const audible = this.outputRouted
            ? !active.stopPromise
            : !active.audio.muted || Boolean(active.censorTone);
          const playing = !active.audio.paused && audible;
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
      active.sessionId = result.sessionId;
      active.token = result.token;
      // A create response may arrive after stop/dispose, despite aborting its
      // request. Release the newly discovered slot instead of losing its token.
      if (this.active !== active) {
        this.recover(active, true);
        return;
      }
      this.renewLease(active);
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
  private onEvent(active: ActiveSession, event: Record<string, unknown>) {
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
          (event.error &&
          typeof event.error === "object" &&
          "message" in event.error &&
          typeof event.error.message === "string"
            ? event.error.message
            : "The session reported an error."),
      });
      return;
    }
    if (event.type === "session.closed") {
      if (active.closed) active.closed();
      else {
        this.update({ error: "Voice session ended. Reconnect to continue." });
        this.cleanup(active);
        this.recover(active);
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
        typeof event.start_ms !== "number" ||
        !Number.isFinite(event.start_ms) ||
        typeof event.end_ms !== "number" ||
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
      else {
        // Live transcripts can split a marker across deltas ("BE" + "EP").
        const tail = active.censorTail ?? "";
        const text = tail + event.delta;
        if ([...text.matchAll(/\bBEEP\b/gi)].some((match) => match.index! + match[0].length > tail.length))
          this.censorBeep(active);
        active.censorTail = text.slice(-32);
      }
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
      event.delegation &&
      typeof event.delegation === "object" &&
      "target" in event.delegation &&
      event.delegation.target === "client" &&
      "id" in event.delegation &&
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
  private sync(active: ActiveSession, keepalive = false) {
    if (!active.token) return Promise.resolve();
    const messages = [
      ...new Map(
        [
          ...(active.transcript?.messages() ?? []),
          ...this.dependencies
            .messages(active.threadId)
            .filter((message) =>
              message.id.startsWith("voice-" + active.sessionId + "-"),
            ),
        ].map((message) => [message.id, message]),
      ).values(),
    ];
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
            { detached: true, keepalive },
          );
        }
      });
    return active.syncQueue;
  }
  stop = () => {
    this.talkRequested = false;
    const active = this.active;
    if (!active) return this.flush();
    if (active.stopPromise) return active.stopPromise;
    this.update({ status: "closing" });
    active.microphone?.getTracks().forEach((track) => {
      track.enabled = false;
    });
    active.audio.muted = true;
    clearTimeout(active.syncTimer);
    clearTimeout(active.leaseTimer);
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
        await this.flushInterrupted();
        await this.sync(active);
      } catch (error) {
        await this.sync(active).catch(() => {});
        this.recover(active);
        this.update({
          error:
            error instanceof Error
              ? error.message
              : "Could not finish the voice conversation.",
        });
        throw error;
      } finally {
        this.cleanup(active);
        // Release even if provider finalization or transcript persistence fails.
        // A failed save remains recoverable with this session's capability.
        try {
          await this.release(active);
        } catch {
          this.recover(active);
        }
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
  private async flushInterrupted() {
    for (const [id, active] of this.interruptedSaves) {
      await active.recoveryPromise;
      await this.sync(active);
      await this.release(active);
      this.interruptedSaves.delete(id);
    }
  }
  flush = async () => {
    try {
      await this.flushInterrupted();
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
        "The scenario or selected document context has changed. Earlier details may be outdated. Delegate only factual questions requiring current scenario, document, or feedback evidence to the backend. Respond directly to insults, feelings, and ordinary conversation. Never announce a lookup, checking notes, or pulling up details; retrieve required facts silently.",
    });
  }
  dispose = () => {
    if (this.active) {
      const active = this.active;
      this.send(active, { type: "session.close" });
      active.closed?.(new Error("Voice closed before finalization."));
      this.cleanup(active);
      this.recover(active, true);
    }
    // Retry earlier failed saves when a page is leaving as well.
    for (const active of this.interruptedSaves.values())
      this.recover(active, true);
  };
}
