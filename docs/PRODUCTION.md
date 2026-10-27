# Run the localhost demo

The current app is a localhost conference demo. It opens directly without a presenter password, login, signed session cookie, or account setup. All conversations use the shared `localhost-demo` identity. Use one frontend and one backend process; this configuration does not provide separate user accounts or isolation between presenters sharing the demo.

## Normal development flow

Use Node 24 LTS (`.node-version`) and install both lockfiles:

```bash
npm ci
npm ci --prefix src/backend
cp .env.example .env
# Set GEMINI_API_KEY and OPENAI_API_KEY for the default providers.
npm run dev
```

Open `http://127.0.0.1:3000` or `http://localhost:3000`. The frontend binds to loopback. Without a provider key, pages still open and generation returns a recoverable configuration error.

The launcher loads the root `.env` through `dotenv-cli`, generates a random internal `MING_BACKEND_TOKEN` if absent, and gives the same token to Next and Mastra. Mastra receives a temporary comment-only env file so its own env parser cannot overwrite inherited values with a blank token from `.env`. No generated token is printed or saved to disk. Ctrl+C stops both servers and removes that temporary file. Restart the launcher after changing `.env`.

The browser uses the same-origin `/api/backend` proxy. The provider key and internal token stay server-only. The proxy checks request origin and size; Mastra accepts the internal token, blocks its built-in framework endpoints, and limits request complexity and generation work. These controls do not add a user login.

## Text and voice providers

`MING_TEXT_PROVIDER=gemini` is the default for all text agents, sentiment, reports and voice reasoning. Set `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `GOOGLE_API_KEY` (first nonblank value in that order); the Veo helpers use the same server-side key precedence. `GEMINI_MODEL` can override the default `gemini-3.8-flash`. Use `MING_TEXT_PROVIDER=openai` with `OPENAI_API_KEY` to select OpenAI text; `OPENAI_TEXT_MODEL` defaults to `gpt-6-luna`.

`MING_VOICE_PROVIDER=openai` keeps the existing OpenAI Live WebRTC path and requires `OPENAI_API_KEY`. The default configuration therefore uses both Gemini and OpenAI credentials. `MING_VOICE_PROVIDER=deepgram` uses browser MediaRecorder hold-to-talk, Deepgram STT, the selected text model, and Deepgram TTS. Set `DEEPGRAM_API_KEY`; optional model overrides are `DEEPGRAM_STT_MODEL=nova-3` and `DEEPGRAM_TTS_MODEL=aura-2-orion-en`. Optional `MING_TTS_PROVIDER=gemini` speaks replies with Gemini TTS (`GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts`, `GEMINI_TTS_VOICE=Puck`, the Gemini key precedence above) as streamed 24 kHz PCM capped at 4 MiB; `MING_TTS_PROVIDER=openai` speaks them with OpenAI TTS instead (`OPENAI_API_KEY`, `OPENAI_TTS_MODEL=gpt-4o-mini-tts`, `OPENAI_TTS_VOICE=cedar`) in the same PCM format and with the same Deepgram fallback; OpenAI shuts that endpoint down on 2027-01-06. Any other value keeps Deepgram TTS, the default. A Gemini failure before the first audio byte (quota, network, missing key, empty output) falls back to Deepgram for that same request without extra quota; the free Gemini TTS tier allows only a few requests per minute and per day. Gemini + Deepgram does not need an OpenAI key. Restart both services after changing provider configuration; there is no silent fallback.

Deepgram processes each utterance after release, with a 30-second recording cap. Its audio endpoint alone permits up to 2 MiB of JSON and 1 MiB of decoded audio; other requests retain the 256 KiB cap. Transcripts are saved before the final response; End Scenario waits for pending voice work. Speech synthesis failure leaves the generated text available for reports. No audio or API key is placed in public environment variables.

The Veo video helpers remain available, using lazy server-only Gemini credentials. This does not automatically regenerate the existing scenario video.

## Follow-up practice and new sessions

After completing a conversation, open its report and select **Generate follow-up**. The app uses that report's feedback to generate a new workplace scenario with Bart and supporting documents. Review its goal and documents, then select **Start follow-up**. Generation errors leave the report available; use Retry or Cancel as needed. Cancelling stops the browser from accepting a late result, but model work already started may still finish on the backend.

Generated scenarios are validated before being shown or started. The saved follow-up is tied to the report that produced it, and the selected scenario persists across reloads in that browser tab. Bart's text and voice responses use the selected scenario's role, personality, and facts. The existing Bart video remains the visual; follow-up generation does not call Veo.

**New Session** in the navigation starts a fresh conversation with the original Bart scenario. It waits for pending voice saves and keeps saved reports and completion history. If a voice recording fails, retry saving it or explicitly choose **Continue by text** before starting again. Starting a follow-up also creates a fresh conversation, so the previous role-play and report-coaching messages do not carry over.

Implementation references: [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Deepgram transcription](https://developers.deepgram.com/docs/pre-recorded-audio), [Deepgram speech synthesis](https://developers.deepgram.com/reference/text-to-speech/speak-request). Provider output and real microphone behavior still require a live rehearsal once keys are supplied.

Optional settings:

- `MING_BACKEND_URL`: defaults to `http://127.0.0.1:4111`.
- `MING_BACKEND_TOKEN`: normally generated automatically. Set a random value of at least 32 characters when launching services separately; both must inherit the same value.
- `MING_APP_ORIGIN`: normally unset; the proxy accepts the current loopback origin. Set an exact origin only when intentionally using a different setup.
- `MING_DATABASE_URL`: optional database URL for the local process; the container setup uses a persistent volume.

Do not expose this shared localhost demo directly to other users. A public application needs an explicit identity and access design.

## Checks and rehearsal

```bash
npm run typecheck
npm run typecheck --prefix src/backend
npm run lint
npm run test:voice
npm run test:providers
npm run test:deepgram
npm run test:demo
npm run test:adaptive
node --test tests/frontend-security.test.mjs tests/backend-security.test.mjs tests/quality-gates.test.mjs tests/markdown-security.test.mjs
```

Builds enforce types and lint. The frontend build fetches its configured Google Fonts, so prepare build artifacts before the event if using a built server. Runtime smoke scripts use synthetic requests and no provider key; they do not certify real AI output or microphone behavior. Rehearse voice → End Scenario → report on the actual laptop and microphone, including restart/reconnect behavior and provider entitlement. Keep any backup recording clearly labelled.

## Optional local containers

The retained Docker target runs a built Next process and one private Mastra process. It is optional; `npm run dev` does not require Docker.

For container mode, set a fixed `MING_BACKEND_TOKEN` in `.env` using a generated value such as `openssl rand -hex 32`. No access password or session secret is needed. Set the keys for the selected providers (Gemini + OpenAI Live by default), then run:

```bash
docker compose config --quiet
docker compose build --pull
docker compose up -d
```

Only the frontend is published, on host loopback port 3000. The backend has no published port. Its database persists in the `ming-data` volume at `/data/storage.db`; do not remove that volume if you want to retain conversations. Images use Node 24, run as nonroot with read-only root filesystems, and have temporary scratch space and memory limits. Keep one replica of each service: generation budgets and live voice state are held in memory. A backend restart requires voice to reconnect.

Container boot still needs verification on a host with a running Docker daemon. No remote deployment is part of this setup.

## Dependency snapshot — 2026-10-25

Next.js 15.5.28, React 19.1.10, and sharp 0.35.5 incorporate the [maintainer's October 14, 2026 security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026). Unused Cloudflare/OpenNext and provider tooling were removed. The former backend Cloudflare scripts did not deploy Mastra's actual Node output and were removed.

The 2026-10-25 production dependency audit reports **0 critical / 4 high** for the frontend and **0 critical / 12 high** for the backend after restoring the Google provider packages. These include overlapping dependency paths. Legacy Cedar/Mastra still bring affected Zod and OpenTelemetry versions. Requests are capped before Zod at 256 KiB (2 MiB only for Deepgram audio turns), depth 20, 256 entries per collection, and 4096 total values. Telemetry/observability remain disabled; the built container command does not load the instrumentation bootstrap. Moderate and low advisories also remain. These controls do not patch the packages themselves; a compatible SDK migration is still needed for a clean audit. Do not apply `npm audit fix --force` across the pinned Mastra peer set without compatibility checks.

Historical screenshots and evidence under `docs/demo-readiness-2026/` describe the dates and behavior recorded there; earlier protected-presenter checks are not evidence of a login requirement in the current localhost flow.
