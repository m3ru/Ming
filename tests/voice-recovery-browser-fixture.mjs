// SYNTHETIC browser QA only. No provider or backend validation.
// Run: node tests/voice-recovery-browser-fixture.mjs
// Open: http://127.0.0.1:3002/scenario
// Inspect safe counters: http://127.0.0.1:3002/__fixture/status
// The existing Next dev server at fixed 127.0.0.1:3000 is read-only upstream.
// No environment variables, credentials, cookies, or authorization are read/forwarded.
import { createServer, request as httpRequest } from "node:http";

const HOST = "127.0.0.1";
const PORT = 3002;
const UPSTREAM_PORT = 3000;
const counts = {
  voice: 0,
  chat: 0,
  report: 0,
  sentiment: 0,
  scenarioNext: 0,
  microphoneAcquired: 0,
  microphoneStopped: 0,
  recordingStarted: 0,
  recordingStopped: 0,
  htmlInjected: 0,
  providerPropOverrides: 0,
};
const observed = {
  voiceHasAudio: false,
  reportHasTranscript: false,
  followUpHasAnalysis: false,
  followUpThreadId: null,
};
const followUp = { mode: "success", delayMs: 0 };
const followUpScenario = {
  title: "Synthetic follow-up: agree on a recovery plan",
  goal: "Agree on one specific next step and ask Bart to confirm the plan.",
  goalForAnalyzer:
    "Practice clear next steps and active listening after the synthetic completed report.",
  situation:
    "Synthetic browser QA scenario. Meet Bart to check progress and agree on a specific recovery plan. This is canned fixture content, not provider output.",
  situationForAnalyzer:
    "A manager checks progress and agrees on concrete commitments with Bart.",
  companyDetails:
    "Ming values transparency, collaboration, and sustainable commitments.",
  userRole: "Bart’s engineering manager",
  npcs: [
    {
      name: "Bart",
      role: "Software Engineer",
      pfp: "https://randomuser.me/api/portraits/men/12.jpg",
      personality: "Thoughtful and cooperative.",
      scenarioSpecificInfo:
        "Wants to agree on a clear next step after the review.",
    },
  ],
  documents: [
    {
      title: "Synthetic recovery plan",
      type: "report",
      content: [
        {
          format: "plain",
          content:
            "Synthetic fixture document: confirm one owner, next step, and review date.",
        },
      ],
    },
  ],
};

const summaryAnalysis = `## CONVERSATION OVERVIEW
Synthetic browser QA report: the manager asked Bart about the delayed project.

## USER PERFORMANCE ANALYSIS
The manager asked a clear question and acknowledged Bart's perspective. This is synthetic fixture feedback, not an AI evaluation.

## IMPROVEMENT RECOMMENDATIONS
Agree on one specific next step and ask Bart to confirm the plan.

## RATING
- Empathy: 71/100
- Clarity: 72/100
- Open-mindedness: 73/100
- Assertiveness: 74/100
- Active Listening: 75/100
- Conflict Management: 76/100`;
const detailedFeedback = `<segment: Opening discussion>
User: Could we talk about the project delay?
Bart: I understand the concern. I missed the deadline and would like to agree on a plan.

Synthetic browser QA annotation: the question opens discussion clearly. This text is canned fixture content.
</segment: Opening discussion>`;

// Runs before any Next scripts. The actual app/controller still handles native
// press/release, capture, failed-turn retention, discard, typed chat, and reports.
const bootstrap = String.raw`(() => {
  const event = (name) => fetch('/__fixture/event', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({name}),
  }).catch(() => {});
  class SyntheticMediaRecorder extends EventTarget {
    static isTypeSupported(type) { return type.startsWith('audio/'); }
    constructor(stream, options = {}) {
      super(); this.stream = stream; this.mimeType = options.mimeType || 'audio/webm';
      this.state = 'inactive'; this.ondataavailable = null; this.onstop = null;
      this.onerror = null;
    }
    start() {
      if (this.state !== 'inactive') throw new DOMException('Already recording', 'InvalidStateError');
      this.state = 'recording'; event('recordingStarted');
    }
    stop() {
      if (this.state === 'inactive') throw new DOMException('Not recording', 'InvalidStateError');
      this.state = 'inactive'; event('recordingStopped');
      queueMicrotask(() => {
        const data = new Event('dataavailable');
        Object.defineProperty(data, 'data', {value: new Blob([new Uint8Array(4096)], {type:this.mimeType})});
        this.ondataavailable?.(data); this.dispatchEvent(data);
        const stopped = new Event('stop'); this.onstop?.(stopped); this.dispatchEvent(stopped);
      });
    }
  }
  Object.defineProperty(window, 'MediaRecorder', {configurable:true, value:SyntheticMediaRecorder});
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{}});
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable:true, value:async () => {
    event('microphoneAcquired');
    const track = {kind:'audio', enabled:false, readyState:'live', stop() {
      if (this.readyState !== 'ended') { this.readyState = 'ended'; event('microphoneStopped'); }
    }};
    return {getTracks:() => [track], getAudioTracks:() => [track]};
  }});
  const label = () => {
    if (document.getElementById('synthetic-voice-fixture-label')) return;
    const banner = document.createElement('div'); banner.id = 'synthetic-voice-fixture-label';
    banner.textContent = 'SYNTHETIC RECOVERY QA · mocked microphone + failed voice service · no provider validation';
    Object.assign(banner.style, {position:'fixed', left:'8px', bottom:'4px', zIndex:'2147483647',
      pointerEvents:'none', padding:'3px 6px', color:'#fff', background:'#6b21a8', font:'10px/1.4 monospace'});
    document.body.append(banner);
  };
  document.addEventListener('DOMContentLoaded', label, {once:true});
})();`;

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2_800_000) throw new Error("Synthetic request too large");
  }
  return body ? JSON.parse(body) : {};
}

function forceDeepgram(text) {
  // This changes only the server/client provider prop in the synthetic response.
  // App source and the existing dev server's environment remain untouched.
  return text
    .replace(/("voiceProvider"\s*:\s*")openai(")/g, (_, a, b) => {
      counts.providerPropOverrides++;
      return `${a}deepgram${b}`;
    })
    .replace(/(\\"voiceProvider\\"\s*:\s*\\")openai(\\")/g, (_, a, b) => {
      counts.providerPropOverrides++;
      return `${a}deepgram${b}`;
    });
}

function proxy(request, response, path) {
  const headers = {
    "accept-encoding": "identity",
    host: `${HOST}:${UPSTREAM_PORT}`,
  };
  for (const key of [
    "accept",
    "range",
    "next-router-prefetch",
    "next-router-state-tree",
    "rsc",
    "next-url",
  ])
    if (typeof request.headers[key] === "string")
      headers[key] = request.headers[key];
  const upstream = httpRequest(
    { host: HOST, port: UPSTREAM_PORT, path, method: "GET", headers },
    (result) => {
      const contentType =
        result.headers["content-type"] || "application/octet-stream";
      response.setHeader("Content-Type", contentType);
      for (const key of ["content-range", "accept-ranges"])
        if (result.headers[key]) response.setHeader(key, result.headers[key]);
      if (
        contentType.includes("text/html") ||
        contentType.includes("text/x-component")
      ) {
        const chunks = [];
        result.on("data", (chunk) => chunks.push(chunk));
        result.on("end", () => {
          let body = forceDeepgram(Buffer.concat(chunks).toString("utf8"));
          if (contentType.includes("text/html")) {
            body = body.replace(
              /<head>/i,
              `<head><script>${bootstrap}</script>`,
            );
            counts.htmlInjected++;
          }
          response.writeHead(result.statusCode || 502);
          response.end(body);
        });
        result.on("error", () => response.destroy());
      } else {
        response.writeHead(result.statusCode || 502);
        result.pipe(response);
      }
    },
  );
  upstream.setTimeout(60_000, () => upstream.destroy());
  upstream.on("error", () => {
    if (!response.headersSent)
      json(response, 502, {
        synthetic: true,
        error:
          "Fixed localhost Next upstream is unavailable at 127.0.0.1:3000.",
      });
    else response.destroy();
  });
  response.on("close", () => upstream.destroy());
  upstream.end();
}

async function handle(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  // Prevent app browser requests to external provider endpoints. Mock routes
  // below never forward to Next's real gateway or the existing backend fixture.
  response.setHeader("Content-Security-Policy", "connect-src 'self'");
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (
    request.headers.origin &&
    request.headers.origin !== `http://${HOST}:${PORT}`
  )
    return json(response, 403, { error: "Synthetic fixture origin denied" });
  if (url.pathname === "/__fixture/status" && request.method === "GET")
    return json(response, 200, {
      synthetic: true,
      providerValidation: false,
      upstream: `http://${HOST}:${UPSTREAM_PORT}`,
      counts,
      observed,
      followUp,
    });
  if (url.pathname === "/__fixture/followup" && request.method === "POST") {
    const input = await readJson(request);
    if (
      !["success", "invalid", "failure"].includes(input.mode) ||
      (input.delayMs !== undefined &&
        (!Number.isInteger(input.delayMs) ||
          input.delayMs < 0 ||
          input.delayMs > 10000))
    )
      return json(response, 400, {
        error:
          "Expected mode success/invalid/failure and optional delayMs 0..10000",
      });
    followUp.mode = input.mode;
    followUp.delayMs = input.delayMs ?? 0;
    return json(response, 200, { synthetic: true, followUp });
  }
  if (url.pathname === "/__fixture/event" && request.method === "POST") {
    const { name } = await readJson(request);
    if (
      ![
        "microphoneAcquired",
        "microphoneStopped",
        "recordingStarted",
        "recordingStopped",
      ].includes(name)
    )
      return json(response, 400, { error: "Unknown synthetic event" });
    counts[name]++;
    return json(response, 200, { synthetic: true });
  }
  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "POST")
      return json(response, 405, { error: "Synthetic fixture expects POST" });
    const input = await readJson(request);
    if (url.pathname === "/api/backend/voice/deepgram/turn") {
      counts.voice++;
      observed.voiceHasAudio =
        typeof input.audioBase64 === "string" && input.audioBase64.length > 0;
      return json(response, 502, {
        code: "PROVIDER_UNAVAILABLE",
        error: "Synthetic fixture: voice service is unavailable.",
        retryable: true,
      });
    }
    if (url.pathname === "/api/backend/chat/stream") {
      counts.chat++;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        "data:I understand the concern. I missed the deadline and would like to agree on a plan.\n\n",
      );
      return response.end("event: done\ndata:\n\n");
    }
    if (url.pathname === "/api/backend/sentiment") {
      counts.sentiment++;
      return json(response, 200, { score: 0.2, magnitude: 0.4 });
    }
    if (url.pathname === "/api/backend/scenario-next") {
      counts.scenarioNext++;
      observed.followUpHasAnalysis =
        typeof input.analysis === "string" &&
        input.analysis.includes("Synthetic browser QA report");
      observed.followUpThreadId =
        typeof input.threadId === "string" ? input.threadId : null;
      const { mode, delayMs } = followUp;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (response.destroyed) return;
      if (mode === "failure")
        return json(response, 503, {
          status: "error",
          error: "Synthetic fixture: follow-up unavailable.",
        });
      return json(response, 200, {
        status: "success",
        result: {
          scenario:
            mode === "invalid"
              ? { title: "Synthetic malformed scenario" }
              : followUpScenario,
        },
      });
    }
    if (url.pathname === "/api/backend/feedback") {
      counts.report++;
      observed.reportHasTranscript =
        typeof input.transcript === "string" &&
        input.transcript.trim().length > 0;
      return json(response, 200, {
        status: "success",
        result: {
          summaryAnalysis,
          detailedFeedback,
          segmentedAnalysis: detailedFeedback,
        },
      });
    }
    return json(response, 503, {
      synthetic: true,
      error: "Unimplemented synthetic API route; no upstream request was made.",
    });
  }
  if (request.method !== "GET" || url.pathname.startsWith("/__fixture/"))
    return json(response, 404, { error: "Unknown synthetic fixture route" });
  // URL parsing intentionally discards any requested host; target is constant.
  proxy(request, response, url.pathname + url.search);
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => {
    if (!response.headersSent)
      json(response, 400, { error: "Invalid synthetic request" });
    else response.destroy();
  });
});
server.on("error", (error) => {
  console.error(`[SYNTHETIC] ${error.message}`);
  process.exitCode = 1;
});
server.listen(PORT, HOST, () =>
  console.log(
    `[SYNTHETIC ONLY] http://${HOST}:${PORT}/scenario · no provider validation · fixed upstream 127.0.0.1:3000`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close());
