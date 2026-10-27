// Live avatar for Bart: the streaming voice stays the brain and the voice; an
// external renderer lip-syncs that audio and returns synced video and audio.
// Bart's voice switches to the synced output only while video is healthy and
// only between utterances, so it is never heard twice and never goes silent
// for long: any start failure, stall or drop hands playback straight back.

export type AvatarPhase = "idle" | "connecting" | "live" | "stalled" | "failed";
/**
 * What the call tile shows: the live video, a loading screen while it connects
 * (the call starts first, then the avatar joins it), or the standard looping
 * Bart only once the avatar cannot load: it failed, or the call itself did.
 */
export function avatarTile(
  phase: AvatarPhase,
  voice: { status: string; error: string | null },
): "video" | "loading" | "fallback" {
  if (phase === "live" || phase === "stalled") return "video";
  if (phase === "failed") return "fallback";
  return phase === "idle" && voice.status === "idle" && voice.error ? "fallback" : "loading";
}
export type AvatarSnapshot = {
  phase: AvatarPhase;
  /** Why the last attempt ended, for the recovery note; null when healthy. */
  failure: "start" | "drop" | null;
  /**
   * Whether Bart is audible from the synced output, which trails his voice
   * track; null while he plays directly or the output cannot be measured.
   */
  audible: boolean | null;
};
export type AvatarGrant = {
  provider: "simli";
  transport: "livekit" | "p2p";
  sessionToken: string;
  iceServers: RTCIceServer[] | null;
};
export type AvatarClient = {
  /** Resolves once the first video frame renders. */
  start(): Promise<void>;
  /** Streams a voice track into the renderer for lip-sync. */
  listen(track: MediaStreamTrack): void;
  /** Called at most once per reason when the provider ends the session. */
  onEnded(callback: (reason: string) => void): void;
  /** Resumes audio processing that a browser suspended before a gesture. */
  resume(): void;
  stop(): Promise<void>;
};
export type AvatarSdk = {
  createClient(
    grant: AvatarGrant,
    video: HTMLVideoElement,
    audio: HTMLAudioElement,
  ): AvatarClient;
};
export type VoiceOutput = {
  subscribeRemoteAudio: (
    listener: (track: MediaStreamTrack | null) => void,
  ) => () => void;
  routeOutput: (routed: boolean) => void;
  /** Censor markers to cover while the synced output plays Bart. */
  subscribeCensor?: (listener: () => void) => () => void;
};
type Dependencies = {
  baseURL: () => string;
  loadSdk?: () => Promise<AvatarSdk>;
  /** Calls onFrame for every presented video frame; returns a stop function. */
  watchFrames?: (video: HTMLVideoElement, onFrame: () => void) => () => void;
  now?: () => number;
};

export const AVATAR_START_TIMEOUT_MS = 20_000;
// No new frame for this long while visible: Bart's voice goes back to direct
// playback. A stall that lasts DROP_MS ends the session and shows the note.
export const AVATAR_STALL_MS = 2_000;
export const AVATAR_DROP_MS = 8_000;
// The synced output trails the voice track by about this much until measured.
export const AVATAR_OUTPUT_DELAY_MS = 800;
// Same tone as direct playback's censor beep.
const CENSOR_TONE_MS = 300;
const WATCH_INTERVAL_MS = 250;

const initial: AvatarSnapshot = { phase: "idle", failure: null, audible: null };

async function loadSimli(): Promise<AvatarSdk> {
  const { SimliClient, LogLevel } = await import("simli-client");
  return {
    createClient(grant, video, audio) {
      const client = new SimliClient(
        grant.sessionToken,
        video,
        audio,
        grant.iceServers,
        LogLevel.ERROR,
        grant.transport,
      );
      // The SDK creates a 16 kHz context for its audio worklet but does not
      // expose it; reach it defensively to resume and close it.
      const context = () =>
        (client as unknown as { audioContext?: AudioContext }).audioContext;
      return {
        start: () => client.start(),
        listen: (track) => client.listenToMediastreamTrack(track),
        onEnded(callback) {
          client.on("stop", () => callback("stopped"));
          client.on("error", (detail) => callback("error: " + detail));
          client.on("startup_error", (detail) =>
            callback("startup error: " + detail),
          );
        },
        resume() {
          const audioContext = context();
          if (audioContext?.state === "suspended")
            void audioContext.resume().catch(() => {});
        },
        async stop() {
          try {
            await client.stop();
          } finally {
            void context()
              ?.close()
              .catch(() => {});
          }
        },
      };
    },
  };
}

function watchVideoFrames(video: HTMLVideoElement, onFrame: () => void) {
  if (typeof video.requestVideoFrameCallback === "function") {
    let handle = 0;
    let stopped = false;
    const frame = () => {
      if (stopped) return;
      onFrame();
      handle = video.requestVideoFrameCallback(frame);
    };
    handle = video.requestVideoFrameCallback(frame);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback?.(handle);
    };
  }
  // Older engines: count decoded frames instead.
  let frames = -1;
  const timer = setInterval(() => {
    const count = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    if (count !== frames) {
      frames = count;
      onFrame();
    }
  }, WATCH_INTERVAL_MS);
  return () => clearInterval(timer);
}

function hidden() {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function isGrant(value: unknown): value is AvatarGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as Record<string, unknown>;
  return (
    grant.provider === "simli" &&
    (grant.transport === "livekit" || grant.transport === "p2p") &&
    typeof grant.sessionToken === "string" &&
    grant.sessionToken.length > 0 &&
    (grant.iceServers === null || Array.isArray(grant.iceServers))
  );
}

export class LiveAvatarController {
  private snapshot: AvatarSnapshot = initial;
  private listeners = new Set<() => void>();
  private video?: HTMLVideoElement;
  private audio?: HTMLAudioElement;
  private client?: AvatarClient;
  private abort?: AbortController;
  private generation = 0;
  private track: MediaStreamTrack | null = null;
  private listened: MediaStreamTrack | null = null;
  private output?: VoiceOutput;
  private unsubscribeVoice?: () => void;
  private unsubscribeCensor?: () => void;
  private routed = false;
  private speaking = false;
  private lastFrameAt = 0;
  private stalledAt = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private stopFrames?: () => void;
  private meter?: { stream: MediaStream; context: AudioContext; frame: number };
  private heardAt = -Infinity;
  private speechStartedAt = -Infinity;
  private outputDelay = AVATAR_OUTPUT_DELAY_MS;
  private censorStarts = new Set<ReturnType<typeof setTimeout>>();
  private censorEnd?: ReturnType<typeof setTimeout>;
  private censorTone?: OscillatorNode;
  private censorContext?: AudioContext;
  private now: () => number;
  constructor(private dependencies: Dependencies) {
    this.now = dependencies.now ?? (() => performance.now());
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Whether Bart's voice currently plays from the synced avatar output. */
  get outputRouted() {
    return this.routed;
  }
  private update(patch: Partial<AvatarSnapshot>) {
    if (
      Object.entries(patch).every(
        ([key, value]) => this.snapshot[key as keyof AvatarSnapshot] === value,
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
    this.evaluateRouting();
  }
  private onAudioState = () => {
    // LiveKit's attach unmutes audio elements; re-assert the routing choice.
    this.applyAudioGate();
    this.evaluateRouting();
    this.watchAudio();
  };
  attach(video: HTMLVideoElement, audio: HTMLAudioElement) {
    this.detach();
    this.video = video;
    this.audio = audio;
    // The avatar video can carry audio too (peer-to-peer mode); never play it.
    video.muted = true;
    video.playsInline = true;
    audio.autoplay = true;
    for (const type of ["playing", "pause", "emptied", "loadedmetadata", "volumechange"])
      audio.addEventListener(type, this.onAudioState);
    this.applyAudioGate();
  }
  detach() {
    this.teardown();
    this.update({ phase: "idle", failure: null });
    for (const type of ["playing", "pause", "emptied", "loadedmetadata", "volumechange"])
      this.audio?.removeEventListener(type, this.onAudioState);
    this.video = undefined;
    this.audio = undefined;
  }
  /** Follows the voice call's remote track and lends it the playback switch. */
  bindVoice(output: VoiceOutput | undefined) {
    this.unsubscribeVoice?.();
    this.unsubscribeCensor?.();
    this.unsubscribeCensor = output?.subscribeCensor?.(() => this.censor());
    if (this.routed) this.output?.routeOutput(false);
    this.routed = false;
    this.applyAudioGate();
    this.output = output;
    this.unsubscribeVoice = output?.subscribeRemoteAudio((track) => {
      this.track = track;
      this.listen();
    });
    return () => {
      this.unsubscribeVoice?.();
      this.unsubscribeVoice = undefined;
      this.unsubscribeCensor?.();
      this.unsubscribeCensor = undefined;
      if (this.output === output) {
        if (this.routed) output?.routeOutput(false);
        this.routed = false;
        this.applyAudioGate();
        this.output = undefined;
      }
    };
  }
  setSpeaking(speaking: boolean) {
    if (speaking && !this.speaking) this.speechStartedAt = this.now();
    this.speaking = speaking;
    this.evaluateRouting();
  }
  connect = async () => {
    if (this.snapshot.phase !== "idle" || !this.video || !this.audio) return;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.update({ phase: "connecting", failure: null });
    try {
      const response = await fetch(
        this.dependencies.baseURL().replace(/\/$/, "") + "/avatar/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(AVATAR_START_TIMEOUT_MS),
          ]),
        },
      );
      const grant: unknown = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          (grant as { error?: string }).error ||
            "Session request failed (HTTP " + response.status + ").",
        );
      if (!isGrant(grant)) throw new Error("Invalid session grant.");
      const sdk = await (this.dependencies.loadSdk ?? loadSimli)();
      if (generation !== this.generation) return;
      const client = sdk.createClient(grant, this.video, this.audio);
      this.client = client;
      client.onEnded((reason) => {
        if (this.client !== client) return;
        this.fail(this.snapshot.phase === "connecting" ? "start" : "drop", reason);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.start(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Timed out waiting for video.")),
              AVATAR_START_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (generation !== this.generation) return;
      this.lastFrameAt = this.now();
      this.startWatchdog();
      this.update({ phase: "live" });
      this.listen();
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail("start", error instanceof Error ? error.message : String(error));
    }
  };
  /** Ends the avatar session, for example when the call ends. */
  disconnect() {
    this.teardown();
    this.update({ phase: "idle", failure: null });
  }
  /** Starts a fresh session after a failure; the recovery note's action. */
  retry = () => {
    if (this.snapshot.phase !== "failed") return;
    this.update({ phase: "idle", failure: null });
    void this.connect();
  };
  /** Call from a user gesture: resumes media the browser held back. */
  resume() {
    this.client?.resume();
    if (this.meter?.context.state === "suspended")
      void this.meter.context.resume().catch(() => {});
    for (const element of [this.audio, this.video])
      if (element?.srcObject && element.paused)
        void element.play().catch(() => {});
  }
  private listen() {
    if (
      !this.client ||
      !this.track ||
      this.track === this.listened ||
      (this.snapshot.phase !== "live" && this.snapshot.phase !== "stalled")
    )
      return;
    this.listened = this.track;
    // Frame health is judged from the moment audio flows in.
    this.lastFrameAt = this.now();
    try {
      this.client.listen(this.track);
    } catch (error) {
      this.fail("drop", error instanceof Error ? error.message : String(error));
    }
  }
  private startWatchdog() {
    if (!this.video) return;
    this.stopFrames = (this.dependencies.watchFrames ?? watchVideoFrames)(
      this.video,
      () => {
        this.lastFrameAt = this.now();
      },
    );
    this.watchdog = setInterval(() => this.checkFrames(), WATCH_INTERVAL_MS);
  }
  private checkFrames() {
    const now = this.now();
    // Background tabs stop presenting frames; that is not a network failure.
    if (hidden() || !this.listened) {
      this.lastFrameAt = now;
      if (this.snapshot.phase === "stalled") this.update({ phase: "live" });
      return;
    }
    const fresh = now - this.lastFrameAt <= AVATAR_STALL_MS;
    if (this.snapshot.phase === "live" && !fresh) {
      this.stalledAt = now;
      this.update({ phase: "stalled" });
    } else if (this.snapshot.phase === "stalled") {
      if (fresh) this.update({ phase: "live" });
      else if (now - this.stalledAt >= AVATAR_DROP_MS)
        this.fail("drop", "No video frames for " + AVATAR_DROP_MS + " ms.");
    }
  }
  private fail(failure: "start" | "drop", reason: string) {
    // Operators see the reason in the console; the page shows a short note.
    console.warn("Live video unavailable:", reason);
    this.teardown();
    this.update({ phase: "failed", failure });
  }
  private teardown() {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.stopFrames?.();
    this.stopFrames = undefined;
    const client = this.client;
    this.client = undefined;
    this.listened = null;
    if (this.routed) this.output?.routeOutput(false);
    this.routed = false;
    this.applyAudioGate();
    this.stopMeter();
    this.censorStarts.forEach(clearTimeout);
    this.censorStarts.clear();
    this.endCensor();
    void this.censorContext?.close().catch(() => {});
    this.censorContext = undefined;
    if (client) void client.stop().catch(() => {});
    // Clear the last frame so the standard tile shows through again.
    for (const element of [this.video, this.audio])
      if (element) element.srcObject = null;
  }
  // Follow the synced output itself, so the speaking cue matches what you hear.
  private watchAudio() {
    const stream = this.audio?.srcObject;
    if (this.meter && this.meter.stream === stream) return;
    this.stopMeter();
    if (
      typeof MediaStream === "undefined" ||
      !(stream instanceof MediaStream) ||
      !stream.getAudioTracks().length
    )
      return;
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const meter = { stream, context, frame: 0 };
      const tick = () => {
        if (this.meter !== meter) return;
        analyser.getByteTimeDomainData(samples);
        const now = this.now();
        if (samples.some((sample) => Math.abs(sample - 128) > 3)) {
          // Each utterance's first sound measures how far the output trails.
          const lag = now - this.speechStartedAt;
          if (this.routed && now - this.heardAt >= 800 && lag > 100 && lag < 3000)
            this.outputDelay = Math.round((this.outputDelay + lag) / 2);
          this.speechStartedAt = -Infinity;
          this.heardAt = now;
        }
        // Same hold as the voice's own flag, so word gaps do not flicker.
        this.update({
          audible:
            this.routed && context.state === "running"
              ? now - this.heardAt < 800
              : null,
        });
        meter.frame = requestAnimationFrame(tick);
      };
      this.meter = meter;
      tick();
    } catch {
      /* The cue falls back to the voice's own speaking flag. */
    }
  }
  private stopMeter() {
    const meter = this.meter;
    if (!meter) return;
    this.meter = undefined;
    cancelAnimationFrame(meter.frame);
    void meter.context.close().catch(() => {});
    this.heardAt = -Infinity;
    this.update({ audible: null });
  }
  private audioPlaying() {
    return Boolean(this.audio && this.audio.srcObject && !this.audio.paused);
  }
  /** Covers a censored word when the synced output plays it. */
  private censor() {
    if (!this.routed) return;
    const timer = setTimeout(() => {
      this.censorStarts.delete(timer);
      // Handed back to direct playback meanwhile: that word has already passed.
      if (!this.routed) return;
      try {
        const context = (this.censorContext ??= new AudioContext());
        void context.resume().catch(() => {});
        clearTimeout(this.censorEnd);
        if (!this.censorTone) {
          const tone = context.createOscillator();
          const gain = context.createGain();
          tone.frequency.value = 1000;
          gain.gain.value = 0.12;
          tone.connect(gain);
          gain.connect(context.destination);
          tone.onended = () => gain.disconnect();
          this.censorTone = tone;
          tone.start();
          this.applyAudioGate();
        }
        this.censorEnd = setTimeout(() => this.endCensor(), CENSOR_TONE_MS);
      } catch {
        this.endCensor();
      }
    }, this.outputDelay);
    this.censorStarts.add(timer);
  }
  private endCensor() {
    clearTimeout(this.censorEnd);
    this.censorEnd = undefined;
    const tone = this.censorTone;
    this.censorTone = undefined;
    try {
      tone?.stop();
    } catch {
      /* Already stopped. */
    }
    tone?.disconnect();
    this.applyAudioGate();
  }
  private applyAudioGate() {
    const audio = this.audio;
    if (!audio) return;
    const muted = !this.routed || Boolean(this.censorTone);
    if (audio.muted !== muted) audio.muted = muted;
    const volume = this.routed ? 1 : 0;
    if (audio.volume !== volume) audio.volume = volume;
  }
  private evaluateRouting() {
    // Take over only at a pause in Bart's speech, so no words repeat or skip;
    // hand back immediately when the synced output is no longer healthy.
    const route =
      Boolean(this.output) &&
      this.snapshot.phase === "live" &&
      this.audioPlaying() &&
      (this.routed || !this.speaking);
    if (route === this.routed) return;
    this.routed = route;
    this.applyAudioGate();
    this.output?.routeOutput(route);
  }
}
