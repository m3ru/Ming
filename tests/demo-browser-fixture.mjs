// Synthetic browser QA fixture. This never contacts an AI or voice provider.
// Run explicitly with: node tests/demo-browser-fixture.mjs
// Configure: curl -X POST http://localhost:4111/__test \
//   -H 'Content-Type: application/json' -d '{"chat":"success","report":"failed"}'
import { createServer } from "node:http";

const port = Number(process.env.MING_BROWSER_FIXTURE_PORT || 4111);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const chatModes = ["success", "http-error", "stream-error", "partial-error"];
const reportModes = ["success", "failed", "invalid", "slow", "partial"];
const mode = { chat: "http-error", report: "failed" };
const automatic = { chat: true, report: true };
const counts = { chat: 0, report: 0, sentiment: 0 };
let lastReportInput = null;

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

function json(response, status, data) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Fixture body too large");
  }
  return body ? JSON.parse(body) : {};
}

async function handle(request, response) {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    json(response, 403, { error: "Synthetic fixture origin denied" });
    return;
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Mastra-Client-Type, X-Mastra-Client-Version",
  );
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/__test") {
    if (request.method === "POST") {
      const next = await readJson(request);
      if (
        (next.chat !== undefined && !chatModes.includes(next.chat)) ||
        (next.report !== undefined && !reportModes.includes(next.report))
      ) {
        json(response, 400, {
          error: "Invalid synthetic fixture mode",
          chatModes,
          reportModes,
        });
        return;
      }
      for (const key of ["chat", "report"]) {
        if (next[key] !== undefined) {
          mode[key] = next[key];
          automatic[key] = false;
        }
      }
    }
    json(response, 200, {
      synthetic: true,
      mode,
      automatic,
      counts,
      lastReportInput,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/chat/stream") {
    await readJson(request);
    counts.chat++;
    const current = mode.chat;
    if (automatic.chat) {
      mode.chat = counts.chat === 1 ? "stream-error" : "success";
    }
    console.log(`[SYNTHETIC] chat ${counts.chat}: ${current}`);
    if (current === "http-error") {
      json(response, 503, {
        type: "error",
        code: "AI_NOT_CONFIGURED",
        message: "Synthetic fixture: AI service is unavailable.",
        retryable: true,
      });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    });
    if (current === "stream-error" || current === "partial-error") {
      if (current === "partial-error") {
        response.write(
          "data:This synthetic partial reply must not count as a completed turn.\n\n",
        );
      }
      response.end(
        `data: ${JSON.stringify({ type: "error", code: "PROVIDER_UNAVAILABLE", message: "Synthetic fixture: AI service is unavailable.", retryable: true })}\n\n`,
      );
      return;
    }
    // Same data-only SSE protocol as the real streamUtils.handleTextStream.
    response.write(
      "data:I understand the concern. I missed the deadline and would like to agree on a plan.\n\n",
    );
    response.end("event: done\ndata:\n\n");
    return;
  }

  if (request.method === "POST" && url.pathname === "/sentiment") {
    await readJson(request);
    counts.sentiment++;
    json(response, 200, { score: 0.2, magnitude: 0.4 });
    return;
  }

  if (request.method === "POST" && url.pathname === "/feedback") {
    const input = await readJson(request);
    lastReportInput = input;
    counts.report++;
    const current = mode.report;
    if (automatic.report) {
      mode.report =
        counts.report === 1
          ? "success"
          : counts.report === 2
            ? "invalid"
            : "success";
    }
    console.log(`[SYNTHETIC] report ${counts.report}: ${current}`);
    if (current === "slow")
      await new Promise((resolve) => setTimeout(resolve, 5000));
    if (current === "failed") {
      json(response, 200, {
        status: "failed",
        error: "Synthetic report provider failure",
      });
      return;
    }
    json(response, 200, {
      status: "success",
      result:
        current === "invalid"
          ? {}
          : {
              summaryAnalysis:
                current === "partial"
                  ? summaryAnalysis.split("\n## RATING")[0]
                  : summaryAnalysis,
              detailedFeedback,
              segmentedAnalysis: detailedFeedback,
            },
    });
    return;
  }

  if (url.pathname.startsWith("/voice")) {
    json(response, 503, {
      error:
        "Voice is disabled in the synthetic browser fixture. Use typed chat.",
    });
    return;
  }

  json(response, 404, {
    error: "Unknown synthetic fixture route",
    path: url.pathname,
  });
}

const servers = ["127.0.0.1", "::1"].map((host) => {
  const server = createServer((request, response) => {
    void handle(request, response).catch(() =>
      json(response, 400, { error: "Invalid synthetic fixture request" }),
    );
  });
  server.on("error", (error) => {
    console.error(
      `[SYNTHETIC] Could not bind ${host}:${port}: ${error.message}`,
    );
    process.exitCode = 1;
    for (const opened of servers) opened.close();
  });
  server.listen(port, host, () =>
    console.log(
      `[SYNTHETIC ONLY] browser fixture listening on ${host}:${port}; no provider proof`,
    ),
  );
  return server;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const server of servers) server.close();
  });
}
