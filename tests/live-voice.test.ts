import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  createLiveVoiceService,
  VoiceError,
  voiceMessageSchema,
} from "../src/backend/src/lib/voice";
import {
  VoiceTranscript,
  voiceContextChunks,
  type ConversationMessage,
} from "../src/lib/voiceTranscript";
import { LiveVoiceController } from "../src/lib/liveVoice";

const message = {
  id: "voice-live-1-user-0",
  role: "user" as const,
  content: "Hello",
  createdAt: "2026-10-24T04:00:00.000Z",
};
const offer = {
  sdp: "offer",
  threadId: "thread-1",
  resourceId: "user-1",
  context: { chatType: { data: "scenario" } },
  messages: [message],
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("overlapping, duplicated and late fragments preserve text and stable persisted IDs", () => {
  const transcript = new VoiceTranscript("session", 0);
  transcript.append({
    event_id: "u2",
    role: "user",
    delta: " again",
    start_ms: 1200,
    end_ms: 1500,
  });
  const id = transcript.messages()[0].id;
  transcript.append({
    event_id: "a1",
    role: "assistant",
    delta: "Yes",
    start_ms: 1100,
    end_ms: 1300,
  });
  const first = {
    event_id: "u1",
    role: "user" as const,
    delta: "Hello",
    start_ms: 1000,
    end_ms: 1200,
  };
  assert.equal(transcript.append(first), true);
  assert.equal(transcript.append(first), false);
  assert.deepEqual(
    transcript.messages().map((m) => m.content),
    ["Hello again", "Yes"],
  );
  assert.equal(transcript.messages()[0].id, id);
  assert.equal(
    (transcript.messages()[0].metadata.fragments as unknown[]).length,
    2,
  );
});

test("context chunks preserve Unicode and stay within the Live append limit", () => {
  const text = "😀日本語 hello ".repeat(150);
  const chunks = voiceContextChunks(text);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 450));
});

test("caption timing metadata survives the server request schema", () => {
  const transcript = new VoiceTranscript("live-1", 0);
  transcript.append({
    event_id: "timing",
    role: "user",
    delta: "Hello",
    start_ms: 1000,
    end_ms: 1400,
  });
  const parsed = voiceMessageSchema.parse(transcript.messages()[0]);
  assert.equal(parsed.metadata?.sessionId, "live-1");
  assert.equal(parsed.metadata?.fragments[0].end_ms, 1400);
});

function service(
  overrides: Partial<Parameters<typeof createLiveVoiceService>[0]> = {},
) {
  return createLiveVoiceService({
    apiKey: () => "test-secret",
    generate: async () => "Verified reply",
    save: async () => {},
    request: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.equal(body.session.model, "gpt-live-1");
      assert.equal(body.session.delegation.type, "client");
      assert.equal(body.transport.type, "webrtc");
      return Response.json({
        session: { id: "live-1" },
        transport: { sdp: "answer" },
      });
    },
    ...overrides,
  });
}

test("session capabilities bind saves to the correct conversation and delegation retries are deduplicated", async () => {
  let generated = 0;
  const saved: unknown[] = [];
  const backend = service({
    generate: async () => {
      generated++;
      return "Result";
    },
    save: async (messages, scope) => {
      saved.push({ messages, scope });
    },
  });
  const session = await backend.create(offer);
  assert.equal(session.sdp, "answer");
  assert.notEqual(session.token, "test-secret");
  const input = {
    sessionId: session.sessionId,
    delegationId: "task-1",
    messages: [message],
    context: {},
  };
  await assert.rejects(
    backend.delegate(input, "wrong-token"),
    (error) => error instanceof VoiceError && error.status === 403,
  );
  const replies = await Promise.all([
    backend.delegate(input, session.token),
    backend.delegate(input, session.token),
  ]);
  assert.equal(generated, 1);
  assert.equal(replies[0].delegationId, "task-1");
  await backend.sync(
    { sessionId: session.sessionId, messages: [message] },
    session.token,
  );
  assert.equal((saved[0] as any).scope.threadId, offer.threadId);
  await assert.rejects(
    backend.sync(
      {
        sessionId: session.sessionId,
        messages: [{ ...message, id: "another-session" }],
      },
      session.token,
    ),
    /does not belong/,
  );
});

test("provider failures and missing credentials are actionable without exposing secrets", async () => {
  await assert.rejects(
    service({ apiKey: () => undefined }).create(offer),
    /root .env/,
  );
  await assert.rejects(
    service({
      request: async () =>
        Response.json({ error: "test-secret" }, { status: 403 }),
    }).create(offer),
    (error) => {
      assert.match((error as Error).message, /GPT-Live access/);
      assert.doesNotMatch((error as Error).message, /test-secret/);
      return true;
    },
  );
});

class FakeChannel {
  readyState = "open";
  sent: any[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  finalize = true;
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  send(raw: string) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === "session.close" && this.finalize)
      queueMicrotask(() => {
        this.emit({
          type: "session.input_transcript.delta",
          event_id: "last",
          delta: " final",
          start_ms: 1200,
          end_ms: 1500,
        });
        this.emit({ type: "session.closed" });
      });
  }
  close() {
    this.readyState = "closed";
  }
}
class FakePeer extends EventTarget {
  static latest: FakePeer;
  channel = new FakeChannel();
  iceGatheringState = "complete";
  connectionState = "connected";
  localDescription = { sdp: "offer" };
  closed = false;
  ontrack?: (event: { track: { stop: () => void } }) => void;
  onconnectionstatechange?: () => void;
  constructor() {
    super();
    FakePeer.latest = this;
  }
  createDataChannel() {
    return this.channel;
  }
  addTrack() {}
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.channel.emit({ type: "session.started" });
  }
  close() {
    this.closed = true;
  }
}
class FakeAudio {
  autoplay = false;
  paused = true;
  muted = false;
  srcObject = null;
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

function controller(
  t: TestContext,
  permission?: () => Promise<unknown>,
  delegate?: () => Promise<Response>,
) {
  const track = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const microphone = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
  let messages: ConversationMessage[] = [];
  let context: Record<string, unknown> = offer.context;
  const saves: ConversationMessage[][] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/voice/session"))
        return Response.json({
          sessionId: "live-1",
          sdp: "answer",
          token: "capability",
        });
      if (String(url).endsWith("/voice/delegate"))
        return delegate
          ? delegate()
          : Response.json({ text: "Backend answer" });
      saves.push(JSON.parse(init!.body as string).messages);
      return Response.json({ saved: true });
    },
  );
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    RTCPeerConnection: FakePeer,
    Audio: FakeAudio,
    navigator: {
      mediaDevices: { getUserMedia: permission ?? (async () => microphone) },
    },
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  t.after(() => {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const voice = new LiveVoiceController({
    baseURL: () => "http://localhost:4111",
    scope: () => ({ ...offer, context, messages }),
    messages: () => messages,
    transcript: (_thread, _session, transcript) => {
      messages = transcript;
    },
  });
  t.after(() => voice.dispose());
  return {
    voice,
    track,
    microphone,
    saves,
    setContext: (value: Record<string, unknown>) => {
      context = value;
    },
    messages: () => messages,
    setMessages: (value: ConversationMessage[]) => {
      messages = value;
    },
  };
}

test("microphone denial shows an error and releases the connection", async (t) => {
  const { voice } = controller(t, async () => {
    throw new Error("Microphone access denied");
  });
  await voice.start();
  assert.equal(voice.getSnapshot().status, "idle");
  assert.match(voice.getSnapshot().error!, /Microphone access denied/);
  assert.ok(FakePeer.latest.closed);
});

test("speaking stays visible through short pauses and clears after silence or stopped playback", async (t) => {
  const fixture = controller(t);
  let now = 0;
  let loud = false;
  let frame!: FrameRequestCallback;
  let playback!: FakeAudio;
  t.mock.method(performance, "now", () => now);
  t.mock.method(FakeAudio.prototype, "play", async function (this: FakeAudio) {
    playback = this;
    this.paused = false;
  });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    MediaStream: class {},
    AudioContext: class {
      createMediaStreamSource() {
        return { connect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          getByteTimeDomainData(samples: Uint8Array) {
            samples.fill(loud ? 140 : 128);
          },
        };
      }
      async close() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  t.after(() => {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const sample = (time: number, audible: boolean) => {
    now = time;
    loud = audible;
    frame(now);
    return fixture.voice.getSnapshot().speaking;
  };

  await fixture.voice.start();
  FakePeer.latest.ontrack?.({ track: { stop() {} } });
  assert.equal(fixture.voice.getSnapshot().speaking, false);
  assert.equal(sample(100, true), true);
  assert.equal(sample(450, false), true);
  assert.equal(sample(600, true), true);
  assert.equal(sample(1300, false), true);
  assert.equal(sample(1500, false), false);
  assert.equal(sample(1600, true), true);
  playback.paused = true;
  assert.equal(sample(1601, true), false);
  playback.paused = false;
  assert.equal(sample(1602, false), false);
  assert.equal(sample(1700, true), true);
  playback.muted = true;
  assert.equal(sample(1701, true), false);
  playback.muted = false;
  assert.equal(sample(1702, false), false);
  assert.equal(sample(1800, true), true);
  await fixture.voice.stop();
  assert.equal(fixture.voice.getSnapshot().speaking, false);
});

test("stopping during permission setup stops tracks even when permission resolves late", async (t) => {
  let grant!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    grant = resolve;
  });
  const fixture = controller(t, () => pending);
  const starting = fixture.voice.start();
  await fixture.voice.stop();
  grant(fixture.microphone);
  await starting;
  assert.ok(fixture.track.stopped);
  assert.equal(fixture.voice.getSnapshot().status, "idle");
});

test("releasing push to talk before microphone permission resolves keeps capture muted", async (t) => {
  let grant!: (value: unknown) => void;
  const permission = new Promise((resolve) => {
    grant = resolve;
  });
  const fixture = controller(t, () => permission);
  const starting = fixture.voice.beginTalking();
  fixture.voice.endTalking();
  grant(fixture.microphone);
  await starting;
  assert.equal(fixture.voice.getSnapshot().status, "connected");
  assert.equal(fixture.voice.getSnapshot().muted, true);
  assert.equal(fixture.track.enabled, false);
  assert.ok(
    !FakePeer.latest.channel.sent.some(
      (event) => event.type === "session.input_audio.unmute",
    ),
  );
  await fixture.voice.stop();
});

test("chat connects muted before any press and push to talk immediately streams on that session", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  const peer = FakePeer.latest;
  assert.equal(fixture.voice.getSnapshot().status, "connected");
  assert.equal(fixture.voice.getSnapshot().muted, true);
  assert.equal(fixture.track.enabled, false);
  assert.equal(peer.channel.sent.length, 0);

  // Capture opens synchronously on keydown, before the caller even awaits it.
  const pressing = fixture.voice.beginTalking();
  assert.equal(fixture.track.enabled, true);
  assert.equal(fixture.voice.getSnapshot().muted, false);
  await pressing;
  fixture.voice.endTalking();
  assert.equal(fixture.track.enabled, false);
  assert.equal(fixture.voice.getSnapshot().muted, true);
  await fixture.voice.beginTalking();
  assert.equal(FakePeer.latest, peer);
  assert.equal(fixture.track.enabled, true);
  fixture.voice.endTalking();
  assert.deepEqual(
    peer.channel.sent.map((event) => event.type),
    [
      "session.input_audio.unmute",
      "session.input_audio.mute",
      "session.input_audio.unmute",
      "session.input_audio.mute",
    ],
  );
  await fixture.voice.stop();
});

test("captions and backend replies are processed while push to talk is still held", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  await fixture.voice.beginTalking();
  const channel = FakePeer.latest.channel;
  channel.emit({
    type: "session.input_transcript.delta",
    event_id: "held-caption",
    delta: "Hello Bart",
    start_ms: 1000,
    end_ms: 1500,
  });
  assert.equal(fixture.messages()[0].content, "Hello Bart");
  channel.emit({
    type: "session.delegation.created",
    delegation: { id: "held-task", target: "client" },
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.ok(
    channel.sent.some((event) => event.type === "session.commentary.append"),
  );
  assert.equal(fixture.track.enabled, true);
  assert.equal(fixture.voice.getSnapshot().muted, false);
  fixture.voice.endTalking();
  assert.equal(fixture.track.enabled, false);
  await fixture.voice.stop();
});

test("startup during the previous conversation's finalization opens a new connection", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  const previous = FakePeer.latest;
  const stopping = fixture.voice.stop();
  const starting = fixture.voice.start();
  await Promise.all([stopping, starting]);
  assert.ok(previous.closed);
  assert.notEqual(FakePeer.latest, previous);
  assert.equal(fixture.voice.getSnapshot().status, "connected");
  assert.equal(fixture.track.enabled, false);
  await fixture.voice.stop();
});

test("graceful stop includes final captions, persists them, and releases microphone and peer", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  assert.equal(fixture.voice.getSnapshot().status, "connected");
  const peer = FakePeer.latest;
  peer.channel.emit({
    type: "session.input_transcript.delta",
    event_id: "first",
    delta: "Hello",
    start_ms: 1000,
    end_ms: 1200,
  });
  assert.equal(fixture.track.enabled, false);
  await fixture.voice.beginTalking();
  assert.equal(fixture.track.enabled, true);
  fixture.voice.endTalking();
  assert.equal(fixture.track.enabled, false);
  await fixture.voice.stop();
  assert.equal(fixture.messages()[0].content, "Hello final");
  assert.equal(fixture.saves.at(-1)![0].content, "Hello final");
  assert.ok(fixture.track.stopped && peer.closed);
});

test("backend replies to an outdated request are not spoken after a user correction", async (t) => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  const { voice } = controller(t, undefined, () => pending);
  await voice.start();
  const channel = FakePeer.latest.channel;
  channel.emit({
    type: "session.input_transcript.delta",
    event_id: "first",
    delta: "Monday",
    start_ms: 1000,
    end_ms: 1300,
  });
  channel.emit({
    type: "session.delegation.created",
    delegation: { id: "task", target: "client" },
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  channel.emit({
    type: "session.input_transcript.delta",
    event_id: "correction",
    delta: "Actually Tuesday",
    start_ms: 3000,
    end_ms: 3500,
  });
  complete(Response.json({ text: "The Monday draft" }));
  await tick();
  assert.ok(
    !channel.sent.some((event) => event.type === "session.commentary.append"),
  );
  assert.ok(
    channel.sent.some(
      (event) =>
        event.type === "session.thinking.append" &&
        event.content.includes("discarded"),
    ),
  );
  await voice.stop();
});

test("typed messages update voice context once without triggering another generation", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  fixture.setMessages([{ ...message, id: "typed-message" }]);
  fixture.voice.syncTypedMessages();
  fixture.voice.syncTypedMessages();
  assert.equal(
    FakePeer.latest.channel.sent.filter(
      (event) => event.type === "session.thinking.append",
    ).length,
    1,
  );
  await fixture.voice.stop();
});

test("scenario changes invalidate old contextual facts without duplicating updates", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  fixture.setContext({ scenarioDetails: { data: { title: "New scenario" } } });
  fixture.voice.syncContext();
  fixture.voice.syncContext();
  const updates = FakePeer.latest.channel.sent.filter(
    (event) => event.type === "session.instructions.append",
  );
  assert.equal(updates.length, 1);
  assert.match(updates[0].content, /Earlier details may be outdated/);
  await fixture.voice.stop();
});

test("failed backend work can be retried without caching a rejected promise", async () => {
  let attempts = 0;
  const backend = service({
    generate: async () => {
      if (++attempts === 1) throw new Error("Temporary failure");
      return "Recovered";
    },
  });
  const session = await backend.create(offer);
  const request = {
    sessionId: session.sessionId,
    delegationId: "retry",
    messages: [message],
    context: {},
  };
  await assert.rejects(
    backend.delegate(request, session.token),
    /Temporary failure/,
  );
  assert.equal(
    (await backend.delegate(request, session.token)).text,
    "Recovered",
  );
  assert.equal(attempts, 2);
});

test("duplicate starts share one connection and startup HTTP errors release it", async (t) => {
  const fixture = controller(t);
  await Promise.all([fixture.voice.start(), fixture.voice.start()]);
  const peer = FakePeer.latest;
  assert.equal(fixture.voice.getSnapshot().status, "connected");
  await fixture.voice.stop();
  assert.ok(peer.closed);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Project has no GPT-Live access" }, { status: 502 }),
  );
  await fixture.voice.start();
  assert.match(fixture.voice.getSnapshot().error!, /GPT-Live access/);
  assert.ok(FakePeer.latest.closed);
});

test("missing session.closed reports incomplete finalization and still saves received captions", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  FakePeer.latest.channel.finalize = false;
  FakePeer.latest.channel.emit({
    type: "session.input_transcript.delta",
    event_id: "partial",
    delta: "Keep this",
    start_ms: 1000,
    end_ms: 1200,
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stopping = fixture.voice.stop();
  const assertion = assert.rejects(stopping, /finalization timed out/);
  t.mock.timers.tick(15000);
  await assertion;
  assert.equal(fixture.voice.getSnapshot().status, "idle");
  assert.match(fixture.voice.getSnapshot().error!, /incomplete/);
  assert.equal(fixture.saves.at(-1)![0].content, "Keep this");
  assert.ok(fixture.track.stopped);
});
