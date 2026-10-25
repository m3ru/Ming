import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { defaultAgent } from "../mastra/agents/defaultAgent";

export const REQUEST_BYTE_LIMIT = 256 * 1024;
export const DEEPGRAM_REQUEST_BYTE_LIMIT = 2 * 1024 * 1024;
export const threadIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/)
  .refine(
    (id) => !id.startsWith("analysis-"),
    "Reserved conversation identifier.",
  );
const principalSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const customRoutes = new Set([
  "/chat/stream",
  "/sentiment",
  "/feedback",
  "/scenario-next",
  "/voice/session",
  "/voice/delegate",
  "/voice/sync",
  "/voice/end",
  "/voice/heartbeat",
  "/voice/deepgram/turn",
  "/voice/deepgram/speech",
]);

export class AccessError extends Error {
  constructor(
    public status: 400 | 403 | 413 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}

// All routes, including Mastra's built-in APIs, pass this middleware. Only the
// narrowly defined application surface is reachable, even with a valid token.
export const gatewayBoundary: MiddlewareHandler = async (c, next) => {
  c.header("Cache-Control", "no-store");
  const expected = process.env.MING_BACKEND_TOKEN;
  if (!expected || expected.length < 32 || expected.trim() !== expected) {
    return c.json({ error: "The application gateway is not configured." }, 503);
  }
  const supplied = c.req.header("x-ming-gateway-token") ?? "";
  // Compare fixed-size digests, including for unequal length and missing input.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(supplied), digest(expected))) {
    return c.json({ error: "Authentication required." }, 401);
  }
  if (!principalSchema.safeParse(c.req.header("x-ming-user-id")).success) {
    return c.json({ error: "Authentication required." }, 401);
  }
  if (c.req.method !== "POST" || !customRoutes.has(c.req.path)) {
    return c.json({ error: "Endpoint unavailable." }, 404);
  }
  if (c.req.path.startsWith("/voice/deepgram/") &&
    !/^application\/(?:ming\+json|json)(?:;|$)/i.test(c.req.header("Content-Type") ?? ""))
    return c.json({ error: "A JSON voice request is required." }, 400);
  // Read incrementally rather than allocating unbounded JSON. The private
  // Next gateway also caps input and uses application/ming+json, avoiding
  // Mastra 0.18's earlier automatic application/json runtime-context parser.
  const reader = c.req.raw.body?.getReader();
  const requestLimit = c.req.path === "/voice/deepgram/turn"
    ? DEEPGRAM_REQUEST_BYTE_LIMIT
    : REQUEST_BYTE_LIMIT;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > requestLimit) {
        void reader.cancel().catch(() => {});
        return c.json({ error: "Request is too large." }, 413);
      }
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks);
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    const pending = [{ value, depth: 0 }];
    let count = 0;
    while (pending.length) {
      const entry = pending.pop()!;
      if (++count > 4096 || entry.depth > 20) throw new Error("limit");
      if (entry.value && typeof entry.value === "object") {
        const values = Object.values(entry.value);
        if (values.length > 256) throw new Error("limit");
        for (const child of values)
          pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  } catch {
    return c.json(
      {
        error: "Invalid or overly complex request.",
        ...(c.req.path === "/chat/stream"
          ? {
              code: "INVALID_CHAT_REQUEST",
              message: "Invalid chat request.",
              retryable: false,
            }
          : {}),
      },
      400,
    );
  }
  c.req.raw = new Request(c.req.raw, { body, duplex: "half" } as RequestInit);
  await next();
};

export function trustedIdentity(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return principalSchema.parse(c.req.header("x-ming-user-id"));
}

// This deployment uses one persistent backend replica. Serialize ownership
// claims so two signed sessions cannot claim the same new thread concurrently.
const threadClaims = new Map<string, Promise<void>>();
export async function claimThread(threadId: string, resourceId: string) {
  threadIdSchema.parse(threadId);
  const previous = threadClaims.get(threadId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  threadClaims.set(threadId, queued);
  await previous;
  try {
    const memory = await defaultAgent.getMemory();
    if (!memory)
      throw new AccessError(503, "Conversation storage is unavailable.");
    const thread = await memory.getThreadById({ threadId });
    if (thread && thread.resourceId !== resourceId) {
      throw new AccessError(403, "Conversation is unavailable.");
    }
    if (!thread)
      await memory.createThread({
        threadId,
        resourceId,
        title: "Practice conversation",
      });
  } finally {
    release();
    if (threadClaims.get(threadId) === queued) threadClaims.delete(threadId);
  }
}

export function analysisThread(threadId: string, resourceId: string) {
  return (
    "analysis-" +
    createHash("sha256")
      .update(resourceId + "\0" + threadId)
      .digest("hex")
  );
}

type Quota = {
  minute: number;
  minuteCount: number;
  hour: number;
  units: number;
  active: number;
};
const quotas = new Map<string, Quota>();
let globalHour = 0;
let globalUnits = 0;
let active = 0;

// Hard limits deliberately apply in every environment. Failed provider calls
// count toward spend limits; disconnecting a stream does not refund its cost.
export function reserveGeneration(identity: string, units = 1) {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const hour = Math.floor(now / 3_600_000);
  for (const [id, quota] of quotas) {
    if (quota.hour !== hour && quota.active === 0) quotas.delete(id);
  }
  if (globalHour !== hour) {
    globalHour = hour;
    globalUnits = 0;
  }
  let quota = quotas.get(identity);
  if (!quota) {
    if (quotas.size >= 2000)
      throw new AccessError(
        429,
        "Application capacity reached. Try again later.",
      );
    quota = { minute, minuteCount: 0, hour, units: 0, active: 0 };
    quotas.set(identity, quota);
  }
  if (quota.minute !== minute) {
    quota.minute = minute;
    quota.minuteCount = 0;
  }
  if (quota.hour !== hour) {
    quota.hour = hour;
    quota.units = 0;
  }
  // Every gateway request carries the same identity ("localhost-demo"), so the
  // per-identity caps match the global ones; lower ones let a rehearsal lock out the demo.
  if (
    active >= 4 ||
    quota.active >= 4 ||
    quota.minuteCount >= 20 ||
    quota.units + units > 600 ||
    globalUnits + units > 600
  ) {
    throw new AccessError(429, "Generation limit reached. Try again later.");
  }
  quota.minuteCount++;
  quota.units += units;
  globalUnits += units;
  quota.active++;
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    quota.active--;
    active--;
  };
}
