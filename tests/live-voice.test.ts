import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  createLiveVoiceService,
  liveDraft,
  VoiceError,
  voiceMessageSchema,
  VOICE_LEASE_MS,
} from "../src/backend/src/lib/voice";
import {
  VoiceTranscript,
  voiceContextChunks,
  type ConversationMessage,
} from "../src/lib/voiceTranscript";
import { LiveVoiceController } from "../src/lib/liveVoice";
import { validateJsonBudget } from "../src/lib/server/security";

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
});

test("a long Live session still fits the gateway's JSON budget", () => {
  // Ten minutes of word-sized captions from both speakers, as /voice/sync sends them.
  const transcript = new VoiceTranscript("live-long", 0);
  for (let i = 0; i < 2400; i++)
    transcript.append({
      event_id: "e" + i,
      role: i % 2 ? "assistant" : "user",
      delta: " word",
      start_ms: i * 250,
      end_ms: i * 250 + 200,
    });
  const messages = transcript.messages();
  for (let offset = 0; offset < messages.length; offset += 128)
    validateJsonBudget(
      JSON.stringify({ sessionId: "live-long", messages: messages.slice(offset, offset + 128) }),
    );
  assert.equal(
    messages.map((m) => m.content).join("").length,
    2400 * " word".length,
  );
});

test("long delegated answers are trimmed to whole sentences that fit one Live append", async () => {
  const sentence = "I hear you and I want to fix the deadline problem together. ";
  const long = sentence.repeat(40).trim();
  const backend = service({ generate: async () => long });
  const session = await backend.create(offer, offer.resourceId);
  const delegate = (delegationId: string) =>
    backend.delegate(
      { sessionId: session.sessionId, delegationId, messages: [message], context: {} },
      session.token,
      offer.resourceId,
    );
  const { text } = await delegate("long");
  assert.ok(Buffer.byteLength(text) <= 1200, "draft exceeds the append budget");
  assert.ok(long.startsWith(text) && text.endsWith("together."));
  // Short answers, and answers with no sentence end or no spaces, still come back whole or cut cleanly.
  assert.equal(liveDraft("Short reply."), "Short reply.");
  assert.ok(!liveDraft("word ".repeat(400)).endsWith(" "));
  // One leading byte shifts the 1,200-byte cut into the middle of a 3-byte character.
  const cut = liveDraft("a" + "日本語".repeat(500));
  assert.ok(Buffer.byteLength(cut) <= 1200);
  assert.ok(!cut.includes("\uFFFD"));
});

test("context chunks preserve Unicode and stay within the Live append limit", () => {
  const text = "😀日本語 hello ".repeat(150);
  const chunks = voiceContextChunks(text);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 450));
});

test("caption messages pass the server request schema", () => {
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
  assert.equal(parsed.createdAt, new Date(1000).toISOString());
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
  const saved: {
    messages: Parameters<
      Parameters<typeof createLiveVoiceService>[0]["save"]
    >[0];
    scope: Parameters<Parameters<typeof createLiveVoiceService>[0]["save"]>[1];
  }[] = [];
  const backend = service({
    generate: async () => {
      generated++;
      return "Result";
    },
    save: async (messages, scope) => {
      saved.push({ messages, scope });
    },
  });
  const session = await backend.create(offer, offer.resourceId);
  assert.equal(session.sdp, "answer");
  assert.notEqual(session.token, "test-secret");
  const input = {
    sessionId: session.sessionId,
    delegationId: "task-1",
    messages: [message],
    context: {},
  };
  await assert.rejects(
    backend.delegate(input, "wrong-token", offer.resourceId),
    (error) => error instanceof VoiceError && error.status === 403,
  );
  const replies = await Promise.all([
    backend.delegate(input, session.token, offer.resourceId),
    backend.delegate(input, session.token, offer.resourceId),
  ]);
  assert.equal(generated, 1);
  assert.equal(replies[0].delegationId, "task-1");
  await backend.sync(
    { sessionId: session.sessionId, messages: [message] },
    session.token,
    offer.resourceId,
  );
  assert.equal(saved[0].scope.threadId, offer.threadId);
  await assert.rejects(
    backend.sync(
      {
        sessionId: session.sessionId,
        messages: [{ ...message, id: "another-session" }],
      },
      session.token,
      offer.resourceId,
    ),
    /does not belong/,
  );
});

test("provider failures and missing credentials are actionable without exposing secrets", async () => {
  await assert.rejects(
    service({ apiKey: () => undefined }).create(offer, offer.resourceId),
    /root .env/,
  );
  await assert.rejects(
    service({
      request: async () =>
        Response.json({ error: "test-secret" }, { status: 403 }),
    }).create(offer, offer.resourceId),
    (error) => {
      assert.match((error as Error).message, /GPT-Live access/);
      assert.doesNotMatch((error as Error).message, /test-secret/);
      return true;
    },
  );
});

test("Live startup asks Bart and the coach to talk naturally without dropping the existing rules", async () => {
  const instructions: string[] = [];
  const backend = service({
    request: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.equal(body.session.delegation.type, "client");
      instructions.push(body.session.instructions);
      return Response.json({ session: { id: "live-" + instructions.length }, transport: { sdp: "answer" } });
    },
  });
  await backend.create(offer, offer.resourceId);
  await backend.create({ ...offer, context: { chatType: { data: "transcript" } } }, offer.resourceId);
  const [bart, coach] = instructions;
  for (const text of [bart, coach]) {
    assert.match(text, /Speak English/);
    assert.match(text, /allow interruptions/);
    assert.match(text, /stress the words that carry the meaning/);
    assert.match(text, /never say stage directions or describe your tone aloud/);
  }
  assert.match(bart, /do not invent facts/);
  assert.match(bart, /natural General American English accent/);
  assert.match(bart, /emotion follow how the other person treats you/);
  assert.match(coach, /without inventing feedback/);
  assert.match(coach, /warm and natural/);
  // Accent and emotion are Bart's; the coach stays neutral.
  assert.doesNotMatch(coach, /accent|emotion/);
});

class FakeChannel {
  readyState = "open";
  sent: { type: string; content?: string }[] = [];
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
  static latest: FakeAudio;
  autoplay = false;
  paused = true;
  muted = false;
  srcObject = null;
  constructor() {
    FakeAudio.latest = this;
  }
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
  transport?: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response> | undefined,
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
  const requests: { url: string; init?: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const custom = transport?.(String(url), init);
      if (custom) return custom;
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
      if (String(url).endsWith("/voice/end")) {
        const input = JSON.parse(init!.body as string);
        assert.equal(input.sessionId, "live-1");
        assert.equal(Object.hasOwn(input, "messages"), false);
        return Response.json({ ended: true });
      }
      if (String(url).endsWith("/voice/heartbeat"))
        return Response.json({ renewed: true });
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
    requests,
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
  t.mock.method(performance, "now", () => now);
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
  const playback = FakeAudio.latest;
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
        event.content?.includes("discarded"),
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
  assert.match(updates[0].content!, /Earlier details may be outdated/);
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
  const session = await backend.create(offer, offer.resourceId);
  const request = {
    sessionId: session.sessionId,
    delegationId: "retry",
    messages: [message],
    context: {},
  };
  await assert.rejects(
    backend.delegate(request, session.token, offer.resourceId),
    /Temporary failure/,
  );
  assert.equal(
    (await backend.delegate(request, session.token, offer.resourceId)).text,
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
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await fixture.voice.start();
  FakePeer.latest.channel.finalize = false;
  FakePeer.latest.channel.emit({
    type: "session.input_transcript.delta",
    event_id: "partial",
    delta: "Keep this",
    start_ms: 1000,
    end_ms: 1200,
  });
  const stopping = fixture.voice.stop();
  const assertion = assert.rejects(stopping, /finalization timed out/);
  t.mock.timers.tick(15000);
  await assertion;
  assert.equal(fixture.voice.getSnapshot().status, "idle");
  assert.match(fixture.voice.getSnapshot().error!, /incomplete/);
  assert.equal(fixture.saves.at(-1)![0].content, "Keep this");
  assert.ok(fixture.track.stopped);
  assert.equal(
    fixture.requests.filter(({ url }) => url.endsWith("/voice/end")).length,
    1,
  );
});

test("released and expired media leases free slots while transcript recovery stays authorized", async () => {
  let now = 1000;
  let sequence = 0;
  const backend = service({
    now: () => now,
    request: async () =>
      Response.json({
        session: { id: "lease-" + ++sequence },
        transport: { sdp: "answer" },
      }),
  });
  const first = await backend.create(offer, offer.resourceId);
  const second = await backend.create(offer, offer.resourceId);
  await assert.rejects(backend.create(offer, offer.resourceId), {
    status: 429,
  });
  await assert.rejects(
    backend.heartbeat(first.sessionId, first.token, "other"),
    { status: 403 },
  );
  now += VOICE_LEASE_MS / 2;
  await backend.heartbeat(first.sessionId, first.token, offer.resourceId);
  now += VOICE_LEASE_MS / 2;
  await assert.rejects(
    backend.heartbeat(second.sessionId, second.token, offer.resourceId),
    { status: 409 },
  );
  const third = await backend.create(offer, offer.resourceId);
  await assert.rejects(backend.create(offer, offer.resourceId), {
    status: 429,
  });
  await backend.end(first.sessionId, first.token, offer.resourceId);
  await backend.end(first.sessionId, first.token, offer.resourceId);
  await backend.create(offer, offer.resourceId);
  for (const session of [first, second]) {
    await backend.sync(
      { sessionId: session.sessionId, messages: [] },
      session.token,
      offer.resourceId,
    );
    await assert.rejects(
      backend.delegate(
        {
          sessionId: session.sessionId,
          messages: [],
          context: {},
          delegationId: "after-close",
        },
        session.token,
        offer.resourceId,
      ),
      { status: 409 },
    );
  }
  now += 90 * 60_000;
  await assert.rejects(
    backend.sync(
      { sessionId: third.sessionId, messages: [] },
      third.token,
      offer.resourceId,
    ),
    { status: 401 },
  );
  await backend.create(offer, offer.resourceId);
});

test("concurrent pending offers still reserve the two available slots", async () => {
  const completed: (() => void)[] = [];
  let sequence = 0;
  const backend = service({
    request: async () => {
      const id = "pending-" + ++sequence;
      await new Promise<void>((resolve) => completed.push(resolve));
      return Response.json({ session: { id }, transport: { sdp: "answer" } });
    },
  });
  const first = backend.create(offer, offer.resourceId);
  const second = backend.create(offer, offer.resourceId);
  await assert.rejects(backend.create(offer, offer.resourceId), {
    status: 429,
  });
  completed.forEach((resolve) => resolve());
  await Promise.all([first, second]);
});

test("refresh and disconnect releases permit more than two immediate reconnects", async (t) => {
  let sequence = 0;
  const backend = service({
    request: async () =>
      Response.json({
        session: { id: "reconnect-" + ++sequence },
        transport: { sdp: "answer" },
      }),
  });
  const fixture = controller(t, undefined, undefined, (url, init) => {
    const body = JSON.parse(init!.body as string);
    const token =
      new Headers(init?.headers).get("authorization")?.slice(7) ?? "";
    return (async () => {
      try {
        if (url.endsWith("/voice/session"))
          return Response.json(await backend.create(body, offer.resourceId));
        if (url.endsWith("/voice/end"))
          return Response.json(
            await backend.end(body.sessionId, token, offer.resourceId),
          );
        if (url.endsWith("/voice/sync"))
          return Response.json(
            await backend.sync(body, token, offer.resourceId),
          );
        throw new Error("Unexpected test request");
      } catch (error) {
        return Response.json(
          { error: (error as Error).message },
          { status: (error as VoiceError).status ?? 500 },
        );
      }
    })();
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    await fixture.voice.start();
    assert.equal(fixture.voice.getSnapshot().status, "connected");
    if (attempt % 2) {
      FakePeer.latest.connectionState = "disconnected";
      FakePeer.latest.onconnectionstatechange?.();
    } else fixture.voice.dispose();
    await tick();
  }
  assert.equal(sequence, 6);
  const releases = fixture.requests.filter(({ url }) =>
    url.endsWith("/voice/end"),
  );
  assert.equal(releases.length, 6);
  for (const { init } of releases) {
    assert.equal(init?.keepalive, true);
    assert.equal(init?.signal?.aborted, false);
  }
});

test("failed disconnect saves survive repeated sessions and stop retries every retained transcript", async (t) => {
  let failSaves = true;
  let sequence = 0;
  const recovered: string[] = [];
  const fixture = controller(t, undefined, undefined, (url, init) => {
    const input = JSON.parse(init!.body as string);
    if (url.endsWith("/voice/session"))
      return Promise.resolve(
        Response.json({
          sessionId: "recover-" + ++sequence,
          token: "capability",
          sdp: "answer",
        }),
      );
    if (url.endsWith("/voice/end"))
      return Promise.resolve(Response.json({ ended: true }));
    if (url.endsWith("/voice/sync")) {
      if (failSaves)
        return Promise.resolve(
          Response.json({ error: "Save unavailable" }, { status: 503 }),
        );
      recovered.push(input.messages[0].content);
      return Promise.resolve(Response.json({ saved: true }));
    }
  });
  for (let index = 0; index < 3; index++) {
    await fixture.voice.start();
    FakePeer.latest.channel.emit({
      type: "session.input_transcript.delta",
      event_id: "caption",
      delta: "Caption " + index,
      start_ms: 0,
      end_ms: 100,
    });
    FakePeer.latest.connectionState = "failed";
    FakePeer.latest.onconnectionstatechange?.();
    await tick();
  }
  await assert.rejects(fixture.voice.stop(), /Save unavailable/);
  failSaves = false;
  await fixture.voice.stop();
  assert.deepEqual(recovered, ["Caption 0", "Caption 1", "Caption 2"]);
});

test("an interrupted save the server no longer recognizes stops blocking later sends", async (t) => {
  let saveStatus = 503;
  const fixture = controller(t, undefined, undefined, (url) =>
    url.endsWith("/voice/sync")
      ? Promise.resolve(
          Response.json(
            { error: "Voice session expired. Start a new conversation." },
            { status: saveStatus },
          ),
        )
      : undefined,
  );
  await fixture.voice.start();
  FakePeer.latest.channel.emit({
    type: "session.input_transcript.delta",
    event_id: "caption",
    delta: "Lost in a restart",
    start_ms: 0,
    end_ms: 100,
  });
  FakePeer.latest.connectionState = "failed";
  FakePeer.latest.onconnectionstatechange?.();
  await tick();
  await assert.rejects(fixture.voice.flush(), /expired/);
  // The backend restarted: the capability for that session is gone for good.
  saveStatus = 401;
  await fixture.voice.flush();
  await fixture.voice.flush();
  await fixture.voice.stop();
});

test("failed final transcript saves release capacity and remain retryable after stop", async (t) => {
  let failSaves = true;
  const fixture = controller(t, undefined, undefined, (url) =>
    url.endsWith("/voice/sync") && failSaves
      ? Promise.resolve(
          Response.json({ error: "Save unavailable" }, { status: 503 }),
        )
      : undefined,
  );
  await fixture.voice.start();
  FakePeer.latest.channel.emit({
    type: "session.input_transcript.delta",
    event_id: "caption",
    delta: "Recover final captions",
    start_ms: 0,
    end_ms: 100,
  });
  await assert.rejects(fixture.voice.stop(), /Save unavailable/);
  assert.equal(
    fixture.requests.filter(({ url }) => url.endsWith("/voice/end")).length,
    1,
  );
  assert.equal(fixture.voice.getSnapshot().status, "idle");
  failSaves = false;
  await fixture.voice.stop();
  assert.equal(
    fixture.saves.at(-1)?.[0].content,
    "Recover final captions final",
  );
});

test("dispose during pending create releases a late session response with a fresh signal", async (t) => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  const fixture = controller(t, undefined, undefined, (url) =>
    url.endsWith("/voice/session") ? pending : undefined,
  );
  const starting = fixture.voice.start();
  await tick();
  fixture.voice.dispose();
  complete(
    Response.json({ sessionId: "live-1", token: "capability", sdp: "answer" }),
  );
  await starting;
  await tick();
  const releases = fixture.requests.filter(({ url }) =>
    url.endsWith("/voice/end"),
  );
  assert.equal(releases.length, 1);
  assert.equal(releases[0].init?.signal?.aborted, false);
  assert.equal(releases[0].init?.keepalive, true);
  assert.equal(fixture.voice.getSnapshot().status, "idle");
});

test("concurrent stop and dispose send one release and retain captions after failed finalization", async (t) => {
  const fixture = controller(t);
  await fixture.voice.start();
  FakePeer.latest.channel.finalize = false;
  FakePeer.latest.channel.emit({
    type: "session.input_transcript.delta",
    event_id: "caption",
    delta: "Keep this",
    start_ms: 0,
    end_ms: 100,
  });
  const stopping = fixture.voice.stop();
  const assertion = assert.rejects(stopping, /closed before finalization/);
  fixture.voice.dispose();
  await assertion;
  await fixture.voice.stop();
  assert.equal(
    fixture.requests.filter(({ url }) => url.endsWith("/voice/end")).length,
    1,
  );
  assert.equal(fixture.saves.at(-1)?.[0].content, "Keep this");
  assert.equal(fixture.voice.getSnapshot().status, "idle");
});

test("connected sessions renew the lease and heartbeat failure releases media", async (t) => {
  const fixture = controller(t, undefined, undefined, (url) =>
    url.endsWith("/voice/heartbeat")
      ? Promise.resolve(
          Response.json({ error: "Voice connection expired" }, { status: 409 }),
        )
      : undefined,
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await fixture.voice.start();
  t.mock.timers.tick(15000);
  await tick();
  assert.equal(
    fixture.requests.filter(({ url }) => url.endsWith("/voice/heartbeat"))
      .length,
    1,
  );
  assert.equal(
    fixture.requests.filter(({ url }) => url.endsWith("/voice/end")).length,
    1,
  );
  assert.equal(fixture.voice.getSnapshot().status, "idle");
  assert.ok(FakePeer.latest.closed);
});

test("heartbeats continue while connected and stop after dispose", async (t) => {
  const fixture = controller(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await fixture.voice.start();
  for (let count = 1; count <= 3; count++) {
    t.mock.timers.tick(15000);
    await tick();
    assert.equal(
      fixture.requests.filter(({ url }) => url.endsWith("/voice/heartbeat"))
        .length,
      count,
    );
  }
  fixture.voice.dispose();
  await tick();
  t.mock.timers.tick(60000);
  await tick();
  assert.equal(
    fixture.requests.filter(({ url }) => url.endsWith("/voice/heartbeat"))
      .length,
    3,
  );
});
