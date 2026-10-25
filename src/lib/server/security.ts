export const MAX_REQUEST_BYTES = 256 * 1024;
export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Internal gateway configuration; there is no presenter login or browser session. */
export function securityConfig(request: Request) {
  const gatewayToken = process.env.MING_BACKEND_TOKEN || "";
  if (gatewayToken.length < 32 || gatewayToken.trim() !== gatewayToken) {
    throw new RequestError("The local gateway is not running. Start both services with npm run dev.", 503);
  }
  const configuredOrigin = process.env.MING_APP_ORIGIN;
  let origin: URL;
  try {
    const requestUrl = new URL(request.url);
    // Next may normalize the internal URL to localhost. Match the browser's
    // actual Host instead; the loopback check below rejects external hosts.
    const host = request.headers.get("host") || requestUrl.host;
    origin = new URL(configuredOrigin || `${requestUrl.protocol}//${host}`);
  } catch {
    throw new RequestError("Invalid application origin.", 503);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((!configuredOrigin && !local) ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && local)) ||
      origin.username || origin.password ||
      (configuredOrigin && (origin.pathname !== "/" || origin.search || origin.hash))) {
    throw new RequestError("Invalid application origin.", 503);
  }
  return { gatewayToken, origin: origin.origin };
}
export function requireSameOrigin(request: Request, config: ReturnType<typeof securityConfig>) {
  if (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestError("This request is not allowed.", 403);
  }
}
export async function boundedBody(request: Request, maxBytes = MAX_REQUEST_BYTES) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new RequestError("Request is too large.", 413);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void reader.cancel(); }, 10_000);
  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      size += value.byteLength;
      if (size > maxBytes) throw new RequestError("Request is too large.", 413);
      chunks.push(value);
    }
  } finally { clearTimeout(deadline); if (!finished) await reader.cancel().catch(() => {}); }
  if (timedOut) throw new RequestError("The request took too long.", 408);
  return Buffer.concat(chunks).toString("utf8");
}
export function errorResponse(error: unknown) {
  const status = error instanceof RequestError ? error.status : 503;
  const message = error instanceof RequestError ? error.message : "The service is temporarily unavailable. Please try again.";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Bound validation work before passing input to downstream schema libraries. */
export function validateJsonBudget(body: string): void {
  let root: unknown;
  try { root = JSON.parse(body); } catch { throw new RequestError("Invalid JSON request."); }
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let count = 0;
  while (queue.length) {
    const { value, depth } = queue.pop()!;
    if (++count > 4096 || depth > 20) throw new RequestError("The request is too complex.", 413);
    if (value && typeof value === "object") {
      if (Array.isArray(value) && value.length > 256) throw new RequestError("The request has too many items.", 413);
      const entries = Object.entries(value);
      if (entries.length > 256) throw new RequestError("The request has too many fields.", 413);
      for (const [key, child] of entries) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new RequestError("Invalid request field.");
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }
}
