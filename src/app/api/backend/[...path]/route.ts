import { boundedBody, errorResponse, RequestError, requireSameOrigin, securityConfig, validateJsonBudget } from "@/lib/server/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const paths = new Set(["chat/stream", "sentiment", "feedback", "scenario-next", "voice/session", "voice/delegate", "voice/sync", "voice/end", "voice/heartbeat", "voice/deepgram/turn", "voice/deepgram/speech", "avatar/session"]);

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const config = securityConfig(request);
    requireSameOrigin(request, config);
    const path = (await context.params).path.join("/");
    if (!paths.has(path)) throw new RequestError("This endpoint is not available.", 404);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RequestError("Use a JSON request.", 415);
    // MediaRecorder audio is base64 inside JSON; only this route gets a larger cap.
    const body = await boundedBody(request, path === "voice/deepgram/turn" ? 2 * 1024 * 1024 : undefined);
    validateJsonBudget(body);
    // Only an operator-configured URL is accepted; user paths cannot choose a host or query.
    const backend = new URL(process.env.MING_BACKEND_URL || "http://127.0.0.1:4111");
    if (!["http:", "https:"].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== "/") throw new RequestError("The backend is not configured.", 503);
    const headers: Record<string, string> = {
      // Mastra's global JSON pre-parser runs before auth/body-limit middleware.
      // Custom content type lets the authenticated route perform its bounded parse.
      "Content-Type": "application/ming+json",
      "x-ming-gateway-token": config.gatewayToken,
      "x-ming-user-id": "localhost-demo",
    };
    const capability = request.headers.get("authorization");
    if (path.startsWith("voice/") && capability && /^Bearer [A-Za-z0-9._~-]{1,512}$/.test(capability)) headers.Authorization = capability;
    const upstream = await fetch(new URL(path, backend), {
      method: "POST", headers, body, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(150_000)]),
    });
    // Never relay cookies, infrastructure headers or arbitrary backend headers.
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    responseHeaders.set("Content-Type", upstream.headers.get("content-type") || "application/json");
    const retry = upstream.headers.get("retry-after");
    if (retry && /^\d{1,6}$/.test(retry)) responseHeaders.set("Retry-After", retry);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) { return errorResponse(error); }
}
