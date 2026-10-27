import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { loadBackendSource } from "./backend-runtime.mjs";

// Offline: no provider SDK, network or keys. The provider HTTP calls, browser
// media elements and avatar SDK are fakes; every app module under test is real.
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL("../" + path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  );
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id === "react/jsx-runtime") return require(id);
      throw new Error(`Unexpected import in ${path}: ${id}`);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const defaultExport = (value) => ({ __esModule: true, default: value });
const VENDORS = /simli|livekit|openai|deepgram|heygen|anam|tavus/i;

// ---------------------------------------------------------------- backend

const avatar = loadBackendSource("src/backend/src/lib/avatar.ts");
const env = {
  MING_AVATAR_PROVIDER: "simli",
  SIMLI_API_KEY: "secret-key",
  SIMLI_FACE_ID: "face-123",
};
function service(environment, respond) {
  const requests = [];
  let time = 0;
  const instance = avatar.createAvatarService({
    env: () => environment,
    now: () => time,
    request: async (url, init) => {
      requests.push({ url: String(url), init });
      return respond(String(url), init);
    },
  });
  return {
    instance,
    requests,
    advance: (ms) => {
      time += ms;
    },
  };
}
const minted = () => Response.json({ session_token: "session-1" });

test("avatar config is off by default and validates operator settings", () => {
  assert.equal(avatar.avatarConfig({}), null);
  assert.equal(avatar.avatarConfig({ MING_AVATAR_PROVIDER: " None " }), null);
  assert.throws(
    () => avatar.avatarConfig({ MING_AVATAR_PROVIDER: "heygen" }),
    (error) => error.status === 503,
  );
  assert.throws(
    () => avatar.avatarConfig({ ...env, SIMLI_FACE_ID: " " }),
    /SIMLI_API_KEY and SIMLI_FACE_ID/,
  );
  assert.throws(() => avatar.avatarConfig({ ...env, SIMLI_FACE_ID: "../face" }));
  assert.throws(() =>
    avatar.avatarConfig({ ...env, MING_AVATAR_TRANSPORT: "carrier-pigeon" }),
  );
  for (const minutes of ["0", "61", "2.5", "many"])
    assert.throws(() =>
      avatar.avatarConfig({ ...env, MING_AVATAR_MAX_MINUTES: minutes }),
    );
  for (const zoom of ["0", "5", "wide"])
    assert.throws(
      () => avatar.avatarConfig({ ...env, MING_AVATAR_ZOOM: zoom }),
      /MING_AVATAR_ZOOM/,
    );
  assert.throws(
    () => avatar.avatarConfig({ ...env, MING_AVATAR_SHIFT_X: "3" }),
    /MING_AVATAR_SHIFT_X/,
  );
  assert.deepEqual(
    avatar.avatarConfig({ ...env, MING_AVATAR_ZOOM: " 0.65 ", MING_AVATAR_SHIFT_X: "0.25" }).camera,
    { zoom: 0.65, pos_x_off: 0.25 },
  );
  assert.deepEqual(
    avatar.avatarConfig({
      ...env,
      MING_AVATAR_PROVIDER: " SIMLI ",
      SIMLI_API_KEY: " secret-key ",
    }),
    {
      provider: "simli",
      apiKey: "secret-key",
      faceId: "face-123",
      transport: "livekit",
      maxSessionSeconds: 1200,
      camera: null,
    },
  );
  assert.equal(
    avatar.avatarConfig({ ...env, MING_AVATAR_TRANSPORT: "P2P" }).transport,
    "p2p",
  );
});

test("token route mints a capped single-session token and keeps key and face server-side", async () => {
  const { instance, requests } = service(
    { ...env, MING_AVATAR_MAX_MINUTES: "15" },
    minted,
  );
  const session = await instance.session();
  assert.deepEqual(session, {
    provider: "simli",
    transport: "livekit",
    sessionToken: "session-1",
    iceServers: null,
    maxSessionSeconds: 900,
  });
  assert.doesNotMatch(JSON.stringify(session), /secret-key|face-123/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.simli.ai/compose/token");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.headers["x-simli-api-key"], "secret-key");
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.faceId, "face-123");
  // Required by the SDK when audio comes from a MediaStreamTrack.
  assert.equal(body.handleSilence, false);
  assert.equal(body.maxSessionLength, 900);
  assert.equal(body.maxIdleTime, avatar.AVATAR_IDLE_SECONDS);
  assert.ok(body.streaming_width >= 512 && body.streaming_height >= 512);
  assert.equal(body.streaming_width * 9, body.streaming_height * 16);
  assert.equal(Object.hasOwn(body, "apiKey"), false);
  // No framing settings: the face keeps its own camera.
  assert.equal(Object.hasOwn(body, "camera"), false);
});

test("framing settings set the session's starting camera", async () => {
  const { instance, requests } = service(
    { ...env, MING_AVATAR_ZOOM: "0.65", MING_AVATAR_SHIFT_X: "-0.2" },
    minted,
  );
  await instance.session();
  assert.deepEqual(JSON.parse(requests[0].init.body).camera, { zoom: 0.65, pos_x_off: -0.2 });
});

test("unconfigured, misconfigured and refused sessions fail without provider details", async (t) => {
  t.mock.method(console, "error", () => {});
  const off = service({}, minted);
  await assert.rejects(off.instance.session(), (error) => error.status === 404);
  const missing = service({ MING_AVATAR_PROVIDER: "simli" }, minted);
  await assert.rejects(missing.instance.session(), (error) => error.status === 503);
  assert.equal(off.requests.length + missing.requests.length, 0);

  const refused = service(
    env,
    () => new Response('{"detail":"bad key secret-key"}', { status: 401 }),
  );
  await assert.rejects(
    refused.instance.session(),
    (error) =>
      error.status === 502 &&
      /HTTP 401/.test(error.message) &&
      !error.message.includes("secret-key"),
  );
  const busy = service(env, () => new Response("", { status: 429 }));
  await assert.rejects(busy.instance.session(), (error) => error.status === 429);
  for (const invalid of [{ session_token: "" }, {}, "not json"]) {
    const broken = service(env, () =>
      typeof invalid === "string"
        ? new Response(invalid)
        : Response.json(invalid),
    );
    await assert.rejects(
      broken.instance.session(),
      (error) => error.status === 502 && error instanceof avatar.AvatarError,
    );
  }
});

test("peer-to-peer sessions carry relay servers, falling back to public STUN", async (t) => {
  t.mock.method(console, "error", () => {});
  const p2p = { ...env, MING_AVATAR_TRANSPORT: "p2p" };
  const relay = [{ urls: "turn:relay.example:443", username: "u", credential: "c" }];
  const ok = service(p2p, (url) =>
    url.endsWith("/compose/ice") ? Response.json(relay) : minted(),
  );
  const session = await ok.instance.session();
  assert.equal(session.transport, "p2p");
  assert.deepEqual(session.iceServers, relay);
  assert.equal(ok.requests[1].url, "https://api.simli.ai/compose/ice");
  assert.equal(ok.requests[1].init.headers["x-simli-api-key"], "secret-key");
  for (const failure of [
    () => new Response("", { status: 500 }),
    () => Response.json([]),
    () => {
      throw new Error("offline");
    },
  ]) {
    const broken = service(p2p, (url) =>
      url.endsWith("/compose/ice") ? failure() : minted(),
    );
    assert.deepEqual((await broken.instance.session()).iceServers, [
      { urls: "stun:stun.l.google.com:19302" },
    ]);
  }
});

test("session starts are rate limited per window, per hour and while pending", async (t) => {
  t.mock.method(console, "error", () => {});
  const limits = avatar.AVATAR_LIMITS;
  const s = service(env, minted);
  for (let index = 0; index < limits.perWindow; index++)
    await s.instance.session();
  await assert.rejects(s.instance.session(), (error) => error.status === 429);
  assert.equal(s.requests.length, limits.perWindow);
  let total = limits.perWindow;
  while (total < limits.perHour) {
    s.advance(limits.windowMs + 1);
    for (let index = 0; index < limits.perWindow && total < limits.perHour; index++, total++)
      await s.instance.session();
  }
  s.advance(limits.windowMs + 1);
  await assert.rejects(s.instance.session(), (error) => error.status === 429);
  s.advance(3_600_000);
  await s.instance.session();

  // Failed provider calls still count, so a retry loop cannot mint without bound.
  const failing = service(env, () => new Response("", { status: 500 }));
  for (let index = 0; index < limits.perWindow; index++)
    await assert.rejects(failing.instance.session(), (error) => error.status === 502);
  await assert.rejects(failing.instance.session(), (error) => error.status === 429);

  const gate = deferred();
  const slow = service(env, () => gate.promise.then(minted));
  const pending = Array.from({ length: limits.pending }, () => slow.instance.session());
  await assert.rejects(slow.instance.session(), (error) => error.status === 429);
  gate.resolve();
  await Promise.all(pending);
  await slow.instance.session();
});

// ------------------------------------------------- configured / unconfigured

const voiceProvider = loadBackendSource("src/lib/voiceProvider.ts");
const avatarProvider = loadBackendSource("src/lib/avatarProvider.ts");

test("the live avatar is opt-in, needs the streaming voice and rejects unknown providers", () => {
  const { resolveAvatarProvider, liveAvatarFor } = avatarProvider;
  assert.equal(resolveAvatarProvider(), null);
  assert.equal(resolveAvatarProvider(""), null);
  assert.equal(resolveAvatarProvider(" None "), null);
  assert.equal(resolveAvatarProvider(" Simli "), "simli");
  assert.throws(() => resolveAvatarProvider("heygen"), /simli or none/);
  assert.equal(liveAvatarFor("openai", "simli"), "simli");
  assert.equal(liveAvatarFor("deepgram", "simli"), null);
  assert.equal(liveAvatarFor("openai", null), null);
});

test("the scenario layout passes only the provider name, and only for streaming voice", (t) => {
  const Provider = () => null;
  const { default: ScenarioLayout } = load("src/app/scenario/layout.tsx", {
    "@/hooks/useLiveAvatar": { LiveAvatarProvider: Provider },
    "@/lib/avatarProvider": avatarProvider,
    "@/lib/voiceProvider": voiceProvider,
  });
  const keys = [
    "MING_AVATAR_PROVIDER",
    "MING_VOICE_PROVIDER",
    "SIMLI_API_KEY",
    "SIMLI_FACE_ID",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  });
  const render = (settings) => {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, settings);
    return ScenarioLayout({ children: "page" });
  };
  const off = render({});
  assert.equal(off.type, Provider);
  assert.equal(off.props.provider, null);
  assert.equal(off.props.children, "page");
  const on = render({
    MING_AVATAR_PROVIDER: "simli",
    SIMLI_API_KEY: "secret-key",
    SIMLI_FACE_ID: "face-123",
  });
  assert.equal(on.props.provider, "simli");
  assert.doesNotMatch(JSON.stringify(on.props), /secret-key|face-123/);
  assert.equal(
    render({ MING_AVATAR_PROVIDER: "simli", MING_VOICE_PROVIDER: "deepgram" })
      .props.provider,
    null,
  );
  assert.throws(() => render({ MING_AVATAR_PROVIDER: "heygen" }));
});

test("the call screen renders the live avatar only when configured, else the standard tile unchanged", () => {
  const scenario = { title: "Review", npcs: [{ name: "Bart" }], documents: [] };
  const ScenarioVideo = () => null;
  const LiveAvatar = () => null;
  const SentimentBar = () => null;
  let provider = null;
  let calls = 0;
  const react = {
    useState: () =>
      ++calls % 2 === 1 ? [{ scenario }, () => {}] : [undefined, () => {}],
    useEffect() {},
    Suspense: "suspense",
  };
  const { default: ScenarioPage } = load("src/app/scenario/page.tsx", {
    react,
    "@/components/ScenarioOverview": defaultExport(() => null),
    "@/components/ScenarioVideo": defaultExport(ScenarioVideo),
    "@/components/LiveAvatar": defaultExport(LiveAvatar),
    "@/hooks/useLiveAvatar": { useLiveAvatarProvider: () => provider },
    "@/backend/src/lib/scenarios": { Scenarios: { negativeReview: scenario } },
    "@/cedar/components/chatComponents/SidePanelCedarChat": {
      SidePanelCedarChat: () => null,
    },
    "@/lib/practiceSession": { readActiveScenario: () => scenario },
    "next/link": defaultExport(() => null),
    "@/components/SentimentBar": defaultExport(SentimentBar),
    "lucide-react": { CircleAlert: () => null },
  });
  const Content = ScenarioPage().props.children.type;
  const tile = () => {
    calls = 0;
    const column = Content().props.children[1];
    assert.equal(column.props.children[1].type, SentimentBar);
    return column.props.children[0];
  };
  const standard = tile();
  assert.equal(standard.type, ScenarioVideo);
  assert.deepEqual(standard.props, { scenario });
  provider = "simli";
  const live = tile();
  assert.equal(live.type, LiveAvatar);
  assert.deepEqual(live.props, { scenario });
});

// -------------------------------------------------------- browser controller

const controllerModule = load("src/lib/liveAvatar.ts");
const {
  LiveAvatarController,
  AVATAR_STALL_MS,
  AVATAR_DROP_MS,
  AVATAR_START_TIMEOUT_MS,
  AVATAR_OUTPUT_DELAY_MS,
} = controllerModule;
const grant = {
  provider: "simli",
  transport: "livekit",
  sessionToken: "session-1",
  iceServers: null,
  maxSessionSeconds: 1200,
};

class FakeMedia extends EventTarget {
  muted = false;
  volume = 1;
  paused = true;
  srcObject = null;
  playsInline = false;
  autoplay = false;
  plays = 0;
  async play() {
    this.plays++;
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
}

function avatarFixture(t, respond = () => Response.json(grant)) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  t.mock.method(console, "warn", () => {});
  let time = 0;
  let frameCallback;
  const requests = [];
  const clients = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), init });
    return respond();
  });
  const sdk = {
    createClient(clientGrant, video, audio) {
      const started = deferred();
      const client = {
        grant: clientGrant,
        started,
        listened: [],
        stopped: 0,
        resumed: 0,
        start: () => started.promise,
        listen(track) {
          client.listened.push(track);
        },
        onEnded(callback) {
          client.end = callback;
        },
        resume() {
          client.resumed++;
        },
        async stop() {
          client.stopped++;
        },
        // The provider attaches its synced media, then the first frame renders.
        goLive() {
          video.srcObject = { kind: "video" };
          audio.srcObject = { kind: "audio" };
          void audio.play();
          started.resolve();
        },
      };
      clients.push(client);
      return client;
    },
  };
  const controller = new LiveAvatarController({
    baseURL: () => "/api/backend/",
    loadSdk: async () => sdk,
    watchFrames: (_video, onFrame) => {
      frameCallback = onFrame;
      return () => {
        frameCallback = undefined;
      };
    },
    now: () => time,
  });
  const video = new FakeMedia();
  const audio = new FakeMedia();
  controller.attach(video, audio);
  const routes = [];
  let pushTrack;
  let censorListener;
  const track = { id: "bart-voice" };
  const unbind = controller.bindVoice({
    subscribeRemoteAudio(listener) {
      pushTrack = listener;
      listener(track);
      return () => {
        pushTrack = undefined;
      };
    },
    routeOutput: (routed) => routes.push(routed),
    subscribeCensor(listener) {
      censorListener = listener;
      return () => {
        censorListener = undefined;
      };
    },
  });
  t.after(() => {
    unbind();
    controller.detach();
  });
  return {
    controller,
    video,
    audio,
    routes,
    track,
    requests,
    clients,
    phase: () => controller.getSnapshot().phase,
    failure: () => controller.getSnapshot().failure,
    pushTrack: (value) => pushTrack(value),
    censor: () => censorListener?.(),
    censorBound: () => Boolean(censorListener),
    frame: () => frameCallback?.(),
    advance(ms) {
      time += ms;
      t.mock.timers.tick(ms);
    },
  };
}
async function goLive(f, { speaking = false } = {}) {
  f.controller.setSpeaking(speaking);
  const connecting = f.controller.connect();
  assert.equal(f.phase(), "connecting");
  await tick();
  await tick();
  const client = f.clients.at(-1);
  assert.ok(client, "the avatar client was created");
  client.goLive();
  await connecting;
  return client;
}

test("a session starts through the backend, streams Bart's voice track and switches playback at a pause", async (t) => {
  const f = avatarFixture(t);
  assert.equal(f.video.muted, true);
  assert.equal(f.video.playsInline, true);
  assert.equal(f.audio.muted, true);
  assert.equal(f.audio.volume, 0);
  const client = await goLive(f, { speaking: true });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/backend/avatar/session");
  assert.equal(f.requests[0].init.method, "POST");
  assert.equal(f.requests[0].init.body, "{}");
  assert.equal(client.grant.sessionToken, "session-1");
  assert.equal(f.phase(), "live");
  assert.deepEqual(client.listened, [f.track]);
  // Bart was mid-sentence: keep direct playback until he pauses.
  assert.deepEqual(f.routes, []);
  assert.equal(f.audio.volume, 0);
  f.controller.setSpeaking(false);
  assert.deepEqual(f.routes, [true]);
  assert.equal(f.controller.outputRouted, true);
  assert.equal(f.audio.muted, false);
  assert.equal(f.audio.volume, 1);
  // Once routed, speech does not bounce playback back and forth.
  f.controller.setSpeaking(true);
  f.controller.setSpeaking(false);
  assert.deepEqual(f.routes, [true]);
  // A reconnected call's new voice track is streamed too.
  const next = { id: "next-voice" };
  f.pushTrack(next);
  assert.deepEqual(client.listened, [f.track, next]);
  f.controller.resume();
  assert.equal(client.resumed, 1);
});

test("the speaking cue measures the synced output while Bart plays from it", async (t) => {
  const f = avatarFixture(t);
  let loud = false;
  let frame;
  const closed = [];
  class FakeStream {
    getAudioTracks() {
      return [{}];
    }
  }
  class FakeContext {
    state = "running";
    createAnalyser() {
      return { fftSize: 256, getByteTimeDomainData: (samples) => samples.fill(loud ? 140 : 128) };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    async close() {
      closed.push(this);
    }
  }
  // Installed after the fixture so its cleanup still sees them.
  for (const [key, value] of Object.entries({
    MediaStream: FakeStream,
    AudioContext: FakeContext,
    requestAnimationFrame: (callback) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  })) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() =>
      prior ? Object.defineProperty(globalThis, key, prior) : Reflect.deleteProperty(globalThis, key),
    );
  }
  const audible = () => f.controller.getSnapshot().audible;
  await goLive(f);
  assert.equal(f.controller.outputRouted, true);
  assert.equal(audible(), null);
  f.audio.srcObject = new FakeStream();
  f.audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(audible(), false);
  loud = true;
  frame();
  assert.equal(audible(), true);
  // Word gaps hold the cue; real silence clears it.
  loud = false;
  f.advance(500);
  frame();
  assert.equal(audible(), true);
  f.advance(400);
  frame();
  assert.equal(audible(), false);
  f.controller.disconnect();
  assert.equal(audible(), null);
  assert.equal(closed.length, 1);
});

test("censored words are covered when the synced output plays them, at its measured delay", async (t) => {
  const f = avatarFixture(t);
  let loud = false;
  let frame;
  const tones = [];
  class FakeStream {
    getAudioTracks() {
      return [{}];
    }
  }
  class FakeContext {
    state = "running";
    destination = {};
    async resume() {}
    async close() {}
    createAnalyser() {
      return { fftSize: 256, getByteTimeDomainData: (samples) => samples.fill(loud ? 140 : 128) };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {}, disconnect() {} };
    }
    createOscillator() {
      const tone = { frequency: { value: 0 }, playing: false, connect() {}, disconnect() {},
        start() { tone.playing = true; }, stop() { tone.playing = false; } };
      tones.push(tone);
      return tone;
    }
  }
  for (const [key, value] of Object.entries({
    MediaStream: FakeStream,
    AudioContext: FakeContext,
    requestAnimationFrame: (callback) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  })) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() =>
      prior ? Object.defineProperty(globalThis, key, prior) : Reflect.deleteProperty(globalThis, key),
    );
  }
  assert.equal(f.censorBound(), true);
  // Not playing Bart yet: direct playback beeps for itself.
  f.censor();
  f.advance(AVATAR_OUTPUT_DELAY_MS);
  assert.equal(tones.length, 0);
  await goLive(f);
  assert.equal(f.controller.outputRouted, true);
  f.audio.srcObject = new FakeStream();
  f.audio.dispatchEvent(new Event("loadedmetadata"));
  // Before any measurement, the word is covered at the default delay.
  f.censor();
  f.advance(AVATAR_OUTPUT_DELAY_MS - 1);
  assert.equal(tones.length, 0);
  assert.equal(f.audio.muted, false);
  f.advance(1);
  assert.equal(tones.length, 1);
  assert.equal(tones[0].playing, true);
  assert.equal(f.audio.muted, true, "the spoken placeholder is muted under the tone");
  f.advance(300);
  assert.equal(tones[0].playing, false);
  assert.equal(f.audio.muted, false);
  f.frame();
  // An utterance that reaches the output 600 ms after the voice track updates the delay.
  f.controller.setSpeaking(true);
  f.advance(600);
  loud = true;
  frame();
  f.controller.setSpeaking(false);
  f.frame();
  f.censor();
  f.advance((AVATAR_OUTPUT_DELAY_MS + 600) / 2 - 1);
  assert.equal(tones.length, 1);
  f.advance(1);
  assert.equal(tones.length, 2);
  // Ending the call stops a pending or sounding tone.
  f.censor();
  f.controller.disconnect();
  f.advance(AVATAR_OUTPUT_DELAY_MS);
  assert.equal(tones.length, 2);
  assert.equal(tones[1].playing, false);
});

test("synced playback waits for the avatar's audio to actually play", async (t) => {
  const f = avatarFixture(t);
  f.controller.setSpeaking(false);
  const connecting = f.controller.connect();
  await tick();
  await tick();
  const client = f.clients[0];
  // Media attached but the browser has not started audio playback.
  f.video.srcObject = {};
  f.audio.srcObject = {};
  // LiveKit's attach unmutes audio elements; that must not leak a second voice.
  f.audio.muted = false;
  f.audio.volume = 1;
  f.audio.dispatchEvent(new Event("volumechange"));
  assert.equal(f.audio.muted, true);
  assert.equal(f.audio.volume, 0);
  client.started.resolve();
  await connecting;
  assert.equal(f.phase(), "live");
  assert.deepEqual(f.routes, []);
  await f.audio.play();
  assert.deepEqual(f.routes, [true]);
  f.audio.paused = true;
  f.audio.dispatchEvent(new Event("pause"));
  assert.deepEqual(f.routes, [true, false]);
  assert.equal(f.audio.muted, true);
});

test("a video stall hands playback back at once, recovers, and ends the session if it persists", async (t) => {
  const f = avatarFixture(t);
  const client = await goLive(f);
  assert.deepEqual(f.routes, [true]);
  for (let index = 0; index < 8; index++) {
    f.advance(250);
    f.frame();
  }
  assert.equal(f.phase(), "live");
  f.advance(AVATAR_STALL_MS + 250);
  assert.equal(f.phase(), "stalled");
  assert.deepEqual(f.routes, [true, false]);
  assert.equal(f.audio.muted, true);
  // Frames resume: video returns, playback switches back at the next pause.
  f.frame();
  f.advance(250);
  assert.equal(f.phase(), "live");
  assert.deepEqual(f.routes, [true, false, true]);
  f.advance(AVATAR_STALL_MS + 250);
  assert.equal(f.phase(), "stalled");
  f.advance(AVATAR_DROP_MS);
  assert.equal(f.phase(), "failed");
  assert.equal(f.failure(), "drop");
  assert.deepEqual(f.routes, [true, false, true, false]);
  assert.equal(client.stopped, 1);
  // The last frame is cleared so the standard tile shows through.
  assert.equal(f.video.srcObject, null);
  assert.equal(f.audio.srcObject, null);
});

test("a provider-side drop mid-call falls back immediately and can be retried", async (t) => {
  const f = avatarFixture(t);
  const client = await goLive(f);
  client.end("error: connection lost");
  assert.equal(f.phase(), "failed");
  assert.equal(f.failure(), "drop");
  assert.deepEqual(f.routes, [true, false]);
  assert.equal(client.stopped, 1);
  // Late provider events from the old session are ignored.
  client.end("stopped");
  assert.equal(f.phase(), "failed");
  f.controller.retry();
  assert.equal(f.phase(), "connecting");
  await tick();
  await tick();
  f.clients[1].goLive();
  await tick();
  assert.equal(f.phase(), "live");
  assert.equal(f.failure(), null);
  assert.equal(f.requests.length, 2);
});

test("start failures leave direct playback alone and report a start failure", async (t) => {
  for (const respond of [
    () => Response.json({ error: "Live video is not enabled on the server." }, { status: 404 }),
    () => Response.json({ error: "Too many live video starts." }, { status: 429 }),
    () => Response.json({ provider: "other", sessionToken: "x" }),
  ]) {
    await t.test("rejected grant", async (t) => {
      const f = avatarFixture(t, respond);
      await f.controller.connect();
      assert.equal(f.phase(), "failed");
      assert.equal(f.failure(), "start");
      assert.equal(f.clients.length, 0);
      assert.deepEqual(f.routes, []);
    });
  }
  await t.test("startup error from the provider", async (t) => {
    const f = avatarFixture(t);
    const connecting = f.controller.connect();
    await tick();
    await tick();
    f.clients[0].end("startup error: invalid face");
    f.clients[0].started.reject(new Error("startup error"));
    await connecting;
    assert.equal(f.phase(), "failed");
    assert.equal(f.failure(), "start");
    assert.equal(f.clients[0].stopped, 1);
  });
  await t.test("first frame never arrives", async (t) => {
    const f = avatarFixture(t);
    const connecting = f.controller.connect();
    await tick();
    await tick();
    f.advance(AVATAR_START_TIMEOUT_MS);
    await connecting;
    assert.equal(f.phase(), "failed");
    assert.equal(f.failure(), "start");
    assert.equal(f.clients[0].stopped, 1);
    assert.deepEqual(f.routes, []);
  });
});

test("ending the call closes the session, and a stale start never goes live", async (t) => {
  const f = avatarFixture(t);
  const client = await goLive(f);
  f.controller.disconnect();
  assert.equal(f.phase(), "idle");
  assert.equal(f.failure(), null);
  assert.equal(client.stopped, 1);
  assert.deepEqual(f.routes, [true, false]);
  const connecting = f.controller.connect();
  await tick();
  await tick();
  const stale = f.clients[1];
  f.controller.disconnect();
  stale.goLive();
  await connecting;
  assert.equal(f.phase(), "idle");
  assert.equal(stale.stopped, 1);
  assert.deepEqual(stale.listened, []);
  // Failure notes never outlive the call.
  stale.end("stopped");
  assert.equal(f.phase(), "idle");
});

// ----------------------------------------------------------- call tile view

function renderTile({ phase, failure = null, speaking = false, audible = null, status = "connected" }) {
  const ScenarioVideo = () => null;
  const retry = () => {};
  class FakeController {
    subscribe = () => () => {};
    getSnapshot = () => ({ phase, failure, audible });
    retry = retry;
  }
  const passthrough = ({ children }) => children;
  const { default: LiveAvatar } = load("src/components/LiveAvatar.tsx", {
    react: {
      useEffect() {},
      useRef: () => ({ current: null }),
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
    "motion/react": {
      AnimatePresence: passthrough,
      motion: new Proxy({}, { get: (_target, tag) => tag }),
      useReducedMotion: () => false,
    },
    "lucide-react": { CircleAlert: "svg" },
    "@/components/ScenarioVideo": defaultExport(ScenarioVideo),
    "@/hooks/useVoiceSession": {
      useVoiceSession: () => ({
        status,
        speaking,
        subscribeRemoteAudio: () => () => {},
        routeOutput: () => {},
      }),
    },
    "@/lib/liveAvatar": { LiveAvatarController: FakeController },
  });
  const scenario = { title: "Review", npcs: [{ name: "Bart" }] };
  const tree = LiveAvatar({ scenario });
  const elements = [];
  const strings = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      strings.push(String(node));
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    elements.push(node);
    for (const [key, value] of Object.entries(node.props ?? {}))
      if (key === "children") walk(value);
      else if (typeof value === "string") strings.push(value);
  };
  walk(tree);
  const text = (element) => {
    const parts = [];
    const collect = (node) => {
      if (typeof node === "string" || typeof node === "number") parts.push(String(node));
      else if (Array.isArray(node)) node.forEach(collect);
      else if (node?.props) collect(node.props.children);
    };
    collect(element);
    return parts.join("");
  };
  return { tree, elements, strings, text, ScenarioVideo, retry, scenario };
}

test("the call tile keeps the standard view underneath and falls back with a short note", () => {
  for (const phase of ["idle", "connecting", "live", "stalled", "failed"]) {
    for (const failure of phase === "failed" ? ["start", "drop"] : [null]) {
      const view = renderTile({ phase, failure, speaking: true });
      const standard = view.elements.filter((e) => e.type === view.ScenarioVideo);
      assert.equal(standard.length, 1, phase);
      assert.equal(standard[0].props.scenario, view.scenario);
      // The SDK detects the first frame with frame callbacks; never hide the video.
      const video = view.elements.find((e) => e.type === "video" && e.props["aria-label"]);
      assert.equal(video.props.muted, true);
      assert.doesNotMatch(video.props.className, /\bhidden\b|invisible|opacity-0/);
      assert.equal(video.props.style?.opacity, undefined);
      assert.equal(video.props.style?.visibility, undefined);
      assert.doesNotMatch(view.strings.join(" "), VENDORS, phase);
      const alert = view.elements.find((e) => e.props?.role === "alert");
      assert.equal(Boolean(alert), phase === "failed", phase);
      const speakingPill = view.strings.some((s) => s.includes("is speaking"));
      assert.equal(speakingPill, phase === "live", phase);
    }
  }
  const dropped = renderTile({ phase: "failed", failure: "drop" });
  const note = dropped.elements.find((e) => e.props?.role === "alert");
  assert.match(note.props.className, /alert-note/);
  assert.equal(dropped.text(note).includes("Live video dropped, but Bart's voice continues."), true);
  const button = dropped.elements.find((e) => e.type === "button");
  assert.equal(dropped.text(button), "Retry video");
  assert.equal(button.props.onClick, dropped.retry);
  const failedStart = renderTile({ phase: "failed", failure: "start" });
  assert.equal(
    failedStart.text(failedStart.elements.find((e) => e.props?.role === "alert")),
    "Live video didn't start, but Bart's voice continues.Retry video",
  );
  const ended = renderTile({ phase: "failed", failure: "drop", status: "idle" });
  assert.equal(ended.elements.some((e) => e.props?.role === "alert"), false);
  const stalled = renderTile({ phase: "stalled" });
  assert.ok(stalled.strings.includes("Reconnecting video…"));
});

test("the speaking cue follows the synced output once Bart's voice plays from it", () => {
  const pill = (view) => view.strings.some((s) => s.includes("is speaking"));
  // Direct playback, or an output that cannot be measured: the voice's own flag.
  assert.equal(pill(renderTile({ phase: "live", speaking: true })), true);
  assert.equal(pill(renderTile({ phase: "live", speaking: false })), false);
  // Synced playback trails the voice track, so the cue waits until it is heard.
  assert.equal(pill(renderTile({ phase: "live", speaking: true, audible: false })), false);
  assert.equal(pill(renderTile({ phase: "live", speaking: false, audible: true })), true);
  // The frame is shown whole and bottom-aligned, never cropped to fill the tile.
  const view = renderTile({ phase: "live" });
  const videos = view.elements.filter((e) => e.type === "video");
  assert.equal(videos.length, 1);
  assert.match(videos[0].props.className, /\baspect-video\b/);
  assert.match(videos[0].props.className, /\bbottom-0\b/);
  // Its backdrop fill covers the standard tile only while video shows.
  const fills = (phase) =>
    renderTile({ phase }).elements.filter((e) => /\bbg-ink\b/.test(e.props?.className ?? "")).length;
  assert.equal(fills("live"), 1);
  assert.equal(fills("stalled"), 1);
  assert.equal(fills("connecting"), 0);
  assert.equal(fills("failed"), 0);
});
