import { z } from "zod";

// Live avatar sessions. The provider key stays here; the browser receives a
// single-session token that the provider caps by length and idle time.
export type AvatarProvider = "simli";
export type AvatarTransport = "livekit" | "p2p";
export type AvatarConfig = {
  provider: AvatarProvider;
  apiKey: string;
  faceId: string;
  transport: AvatarTransport;
  maxSessionSeconds: number;
  /** Starting camera for Trinity-2 faces; null keeps the face's own framing. */
  camera: { zoom: number; pos_x_off: number } | null;
};
export type AvatarSession = {
  provider: AvatarProvider;
  transport: AvatarTransport;
  sessionToken: string;
  iceServers: RTCIceServerLike[] | null;
  maxSessionSeconds: number;
};
type RTCIceServerLike = {
  urls: string | string[];
  username?: string;
  credential?: string;
};
type Env = Record<string, string | undefined>;

export class AvatarError extends Error {
  constructor(
    message: string,
    public status: 404 | 429 | 502 | 503 = 502,
  ) {
    super(message);
  }
}

export const SIMLI_API = "https://api.simli.ai";
// Bounds an orphaned session (crashed tab, lost unload) after audio stops.
export const AVATAR_IDLE_SECONDS = 120;
// 16:9 like the call tile. Trinity-2 faces use it; older faces keep their frame.
export const AVATAR_VIDEO = { width: 1024, height: 576 } as const;
// Every gateway request shares one local identity, so these caps are global.
export const AVATAR_LIMITS = {
  windowMs: 5 * 60_000,
  perWindow: 10,
  perHour: 60,
  pending: 2,
} as const;
const FALLBACK_ICE: RTCIceServerLike[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
const tokenSchema = z.object({ session_token: z.string().min(1).max(8192) });
const iceSchema = z
  .array(
    z.object({
      urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  )
  .min(1)
  .max(16);

/** Only the provider name may cross to the browser; never the key or face. */
export function avatarProviderName(env: Env): AvatarProvider | null {
  const value = env.MING_AVATAR_PROVIDER?.trim().toLowerCase() || "none";
  if (value === "none") return null;
  if (value === "simli") return value;
  throw new AvatarError("MING_AVATAR_PROVIDER must be simli or none.", 503);
}

export function avatarConfig(env: Env): AvatarConfig | null {
  const provider = avatarProviderName(env);
  if (!provider) return null;
  const apiKey = env.SIMLI_API_KEY?.trim();
  const faceId = env.SIMLI_FACE_ID?.trim();
  if (!apiKey || !faceId)
    throw new AvatarError(
      "Set SIMLI_API_KEY and SIMLI_FACE_ID in the root .env, then restart.",
      503,
    );
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(faceId))
    throw new AvatarError("SIMLI_FACE_ID is not a valid face ID.", 503);
  const transport = env.MING_AVATAR_TRANSPORT?.trim().toLowerCase() || "livekit";
  if (transport !== "livekit" && transport !== "p2p")
    throw new AvatarError("MING_AVATAR_TRANSPORT must be livekit or p2p.", 503);
  const minutes = Number(env.MING_AVATAR_MAX_MINUTES?.trim() || "20");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
    throw new AvatarError(
      "MING_AVATAR_MAX_MINUTES must be a whole number from 1 to 60.",
      503,
    );
  // Faces are framed differently: zoom out to show the shoulders, and shift
  // sideways (in half canvas widths) to centre a face framed off-centre.
  const setting = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max)
      throw new AvatarError(`${name} must be a number from ${min} to ${max}.`, 503);
    return value;
  };
  const zoom = setting("MING_AVATAR_ZOOM", 1, 0.2, 4);
  const shift = setting("MING_AVATAR_SHIFT_X", 0, -2, 2);
  return {
    provider,
    apiKey,
    faceId,
    transport,
    maxSessionSeconds: minutes * 60,
    camera: zoom === 1 && shift === 0 ? null : { zoom, pos_x_off: shift },
  };
}

export function createAvatarService(dependencies: {
  env: () => Env;
  request?: typeof fetch;
  now?: () => number;
}) {
  const request = dependencies.request ?? fetch;
  const now = dependencies.now ?? Date.now;
  const started: number[] = [];
  let pending = 0;
  // Each token can open a billed session, so a reconnect loop or a stuck
  // retry button must not mint them without bound. Failed mints still count.
  function reserve() {
    const at = now();
    while (started.length && started[0] <= at - 3_600_000) started.shift();
    const recent = started.filter(
      (time) => time > at - AVATAR_LIMITS.windowMs,
    ).length;
    if (
      pending >= AVATAR_LIMITS.pending ||
      recent >= AVATAR_LIMITS.perWindow ||
      started.length >= AVATAR_LIMITS.perHour
    )
      throw new AvatarError(
        "Too many live video starts. Try again in a few minutes.",
        429,
      );
    started.push(at);
  }
  async function iceServers(apiKey: string) {
    try {
      const response = await request(SIMLI_API + "/compose/ice", {
        method: "GET",
        headers: { "x-simli-api-key": apiKey },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const parsed = iceSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid ICE server list.");
      return parsed.data;
    } catch (error) {
      // Mirrors the SDK: public STUN still connects on most networks, and the
      // browser client falls back to its relayed transport after retries.
      console.error(
        "Avatar ICE server request failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return FALLBACK_ICE;
    }
  }
  return {
    async session(): Promise<AvatarSession> {
      const config = avatarConfig(dependencies.env());
      if (!config)
        throw new AvatarError("Live video is not enabled on the server.", 404);
      reserve();
      pending++;
      try {
        const response = await request(SIMLI_API + "/compose/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-simli-api-key": config.apiKey,
          },
          body: JSON.stringify({
            faceId: config.faceId,
            // The SDK docs require this when audio comes from a MediaStreamTrack.
            handleSilence: false,
            maxSessionLength: config.maxSessionSeconds,
            maxIdleTime: AVATAR_IDLE_SECONDS,
            streaming_width: AVATAR_VIDEO.width,
            streaming_height: AVATAR_VIDEO.height,
            ...(config.camera && { camera: config.camera }),
          }),
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        });
        if (!response.ok) {
          // Provider bodies are not logged or relayed; they may echo request data.
          console.error("Avatar session token request failed", response.status);
          throw new AvatarError(
            "The avatar service refused the session (HTTP " +
              response.status +
              "). Check the key, face ID and remaining minutes.",
            response.status === 429 ? 429 : 502,
          );
        }
        const parsed = tokenSchema.safeParse(
          await response.json().catch(() => null),
        );
        if (!parsed.success)
          throw new AvatarError(
            "The avatar service returned an invalid session.",
          );
        return {
          provider: config.provider,
          transport: config.transport,
          sessionToken: parsed.data.session_token,
          iceServers:
            config.transport === "p2p"
              ? await iceServers(config.apiKey)
              : null,
          maxSessionSeconds: config.maxSessionSeconds,
        };
      } finally {
        pending--;
      }
    },
  };
}
