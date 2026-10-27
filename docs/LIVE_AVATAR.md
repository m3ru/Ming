# Live avatar: Bart lip-synced to his real voice

On the call screen, Bart's looping video can be replaced by a live face that
lip-syncs to the voice the app already produces. GPT-Live stays Bart's brain and
voice. The browser streams Bart's remote audio track to [Simli](https://www.simli.com),
which returns synced video and audio over WebRTC. Bart's voice switches to that
synced audio at a pause in his speech, and it switches back immediately if the
video stalls or fails.

It is off by default. With `MING_AVATAR_PROVIDER=none`, or with
`MING_VOICE_PROVIDER=deepgram`, the call screen is exactly as before.

Checked against Simli's docs and pricing on 2026-10-27, with `simli-client` 3.1.0.

## What it costs

| Plan | Price | Minutes | Custom faces | Concurrent sessions |
| --- | --- | --- | --- | --- |
| Free | $0, no card | 50/month | Stock ("template") faces only | 1 |
| Hobby | $10/month | 1,000/month ($0.01/min) | 1/month | 2 |
| Pro | $49/month | 5,500/month | 5/month | 10 |

Source: https://www.simli.com/pricing.

Two hours of rehearsal plus the demo is about 150 session minutes, which is
**$10 total on Hobby**. You need Hobby for Bart's own face anyway. The app opens
a session only while a call is connected, and every session is capped at
`MING_AVATAR_MAX_MINUTES` (default 20).

## Tonight, step by step

Start step 3 early: face generation is queued, and Simli's docs say it "can take
a couple of hours". Rehearse on a stock face while it builds.

### 1. Sign up and upgrade (about 5 minutes)

1. Sign up at https://app.simli.com. It's self-serve, with no sales call and no card for Free.
2. Upgrade to **Hobby** from the pricing page (https://www.simli.com/pricing).
3. Copy your **API key** from the app.simli.com dashboard. The docs don't name
   the exact menu; look under your account or API section. This is
   `SIMLI_API_KEY`. Keep it in `.env` only and never commit it.

### 2. Rehearse right away on a stock face

Pick a face from https://docs.simli.com/api-reference/preset-faces and use its
ID as `SIMLI_FACE_ID` for now. For example, Daniel is
`03ce3ee8-db97-4150-a333-8f643d48fee9`. Then follow steps 4 and 5.

### 3. Create Bart's face from our image

Two prepared, upload-ready images are in `docs/live-avatar/`:

- `bart-face-video.jpg` (768x768) is the photoreal Bart from the old call
  video (`public/BillyLoop.mp4` at 4.75 s), facing the camera, and the same man
  as the Cast photo. **Try this first.** It is soft, because his face is only
  about 100 px wide in that clip, and his lips are slightly parted.
- `bart-face-photo.jpg` (512x512) is the Cast photo `public/bart.jpg`, upscaled
  from 256 px. It is the same man, but softer and mid-word.
- `bart-face-stylized.jpg` (720x720) is from `public/BillLoopUncropped.mp4`, an
  older 3D cartoon "Bill". It is a different character, and his head is turned
  away from the camera. Use it only as a last resort.

Reframing is free, so compare the `framed.png` results before spending the face.
On a big screen a crisp stock face reads better than a blurry Bart; if all three
come back soft, keep the stock face for the demo.

Simli requires JPEG, PNG or WEBP, at least 512x512 and under 5 MB, with one face
toward the camera. Run these commands in **bash** (type `bash` first if your
shell is fish), from the repo root:

```bash
export SIMLI_API_KEY='paste-your-key'

# a) Reframe (about 25 s). This does not use your face allowance, so retry freely.
curl -sS -X POST "https://api.simli.ai/faces/trinity/preprocess?gsVersion=GSA_2.0" \
  -H "x-simli-api-key: $SIMLI_API_KEY" \
  -F "image=@docs/live-avatar/bart-face-video.jpg" \
  -D headers.txt -o framed.png
grep -i '^warnings:' headers.txt   # advice only; an empty list is ideal
xdg-open framed.png                # check the framing before spending the face

# b) Start the generation. This uses your one Hobby face, unless it fails.
RATIO=$(grep -i '^target-ratio:' headers.txt | cut -d' ' -f2 | tr -d '\r')
curl -sS -X POST "https://api.simli.ai/faces/trinity?gsVersion=GSA_2.0&face_name=bart" \
  -H "x-simli-api-key: $SIMLI_API_KEY" \
  -H "target-ratio: $RATIO" \
  -F "image=@framed.png"
# -> {"message": "<place in queue>", "face_id": "<copy this>", ...}

# c) Poll until "status" is "completed" (or "failed").
curl -sS "https://api.simli.ai/faces/trinity/generation_status?face_id=PASTE_FACE_ID" \
  -H "x-simli-api-key: $SIMLI_API_KEY"
```

If something goes wrong:

- **`framed.png` looks wrong.** `GSA_2.0` (Trinity-2) reframes to waist-up and
  may invent a torso or hands from our head-and-shoulders image. Redo a) and b)
  with `gsVersion=GSA_1.0` (Trinity-1, head-centred, 512x512 video).
- **Generation returns 403.** You have no face allowance left for that
  generation type. Try the other `gsVersion`, or upgrade to Pro.
- **Preprocess rejects the image (no face found).** Repeat with
  `bart-face-photo.jpg`.
- **Generation hasn't finished an hour before you need it.** Keep the stock
  face for the demo.

You can also upload any of these images in the web app instead, at
https://app.simli.com/create/select. API docs:
https://docs.simli.com/api-reference/create-avatar and
https://docs.simli.com/api-reference/trinity-2.

When the status is `completed`, set `SIMLI_FACE_ID` to the new `face_id` and restart.

### 4. Configure

Add to the root `.env`, next to your existing keys:

```bash
MING_VOICE_PROVIDER=openai       # the avatar needs the default streaming voice
MING_AVATAR_PROVIDER=simli
SIMLI_API_KEY=...
SIMLI_FACE_ID=...                # stock face now, Bart's face_id when ready
# Optional:
# MING_AVATAR_TRANSPORT=livekit  # default; relayed WebRTC, best on venue Wi-Fi
# MING_AVATAR_MAX_MINUTES=20     # hard cap per session, 1-60
```

Then restart with `npm run dev`. The provider is read at startup.

### 5. Verify (about 5 minutes)

1. **Token route.** With `npm run dev` running, mint one session token:

   ```bash
   curl -sS -X POST http://127.0.0.1:3000/api/backend/avatar/session \
     -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' -d '{}'
   ```

   Expected: `{"provider":"simli","transport":"livekit","sessionToken":"…",…}`.

   | Response | Cause |
   | --- | --- |
   | 404 | `MING_AVATAR_PROVIDER` isn't set |
   | 503 | Key or face ID missing |
   | 502 | Simli refused the key or face, or you're out of minutes |
   | 429 | The app's cap (10 starts per 5 minutes, 60 per hour). Wait a few minutes. |

   The backend log shows only the HTTP status, never the key.
2. **In Chrome**, open http://127.0.0.1:3000, start a scenario and allow the
   microphone. Within a few seconds the looping video turns into the live face.
3. Hold **Space**, say something, and release. Bart's lips should move with his
   voice, and you should hear him **once**, not doubled or echoed.
4. **Fallback drill.** In DevTools, open Network request blocking, block
   `api.simli.ai`, and reload the call. The standard video stays, with the note
   "Live video didn't start, but Bart's voice continues." and a **Retry video**
   button, and the voice still works. Remove the block and click **Retry video**.
5. Any video failure prints `Live video unavailable: <reason>` in the browser
   console, for you only. The page never names the vendor.

## On stage

- **Kill switch.** Set `MING_AVATAR_PROVIDER=none` and restart. This brings back
  today's call screen exactly. Decide beforehand who flips it and when.
- **Browser.** Use desktop **Chrome**, which is the tested path. Click once on
  the page before the call (any normal navigation counts), so the browser allows
  audio.
- **Network.** Use wired Ethernet or a phone hotspot rather than venue Wi-Fi.
  Keep `livekit` transport: it relays over TURN/TCP when UDP is blocked. `p2p`
  is slightly faster but more fragile behind firewalls.
- **Minutes.** Check your remaining minutes in the Simli dashboard before you
  go on. Running out shows as "Live video didn't start…", and the voice still works.
- **Stalls.** If video freezes for 2 s, Bart's voice switches back to direct
  playback at once and the face blurs with "Reconnecting video…". If frames
  return, video resumes at his next pause. After 8 s frozen, the session ends
  and the standard tile and note appear.

## How it works (for maintainers)

- **Backend.** `src/backend/src/lib/avatar.ts` and the `POST /avatar/session`
  route in `apiRegistry.ts`. The route is behind the same gateway token and
  same-origin proxy as every other route. It mints a single-session token from
  `POST https://api.simli.ai/compose/token`, with `handleSilence: false` as the
  SDK requires for track input, a session cap and a 120 s idle cap. The key and
  face ID never leave the server.
- **Browser.** `src/lib/liveAvatar.ts` streams the GPT-Live remote track with
  the SDK's `listenToMediastreamTrack` (PCM16 at 16 kHz). It decides when Bart's
  voice moves to the synced output, using `LiveVoiceController.routeOutput`, and
  watches for video stalls. `src/components/LiveAvatar.tsx` layers the live
  video over the unchanged `ScenarioVideo`.
- **Speaking indicator.** The `speaking` flag still comes from the direct
  track's level meter. While the voice is routed through the avatar, it leads
  the audible voice by the avatar's latency (a few hundred ms).
- **Tests.** `npm run test:avatar` (offline), plus routing tests in
  `tests/live-voice.test.ts` and gateway checks in
  `tests/backend-security.test.mjs`.
