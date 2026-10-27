<h1 align="center">Ming Management Training</h1>

<p align="center">
  <img width="55%" alt="image" src="https://github.com/user-attachments/assets/67781670-1a0f-45b7-ab5c-9d47196856a0" />
</p>
<p align="center"><em>Ming, featuring realtime voice chat, live sentiment analysis, and a detailed scenario overview.</em></p>
<p align="center">
	<img alt="Google Gemini" src="https://img.shields.io/badge/google%20gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white" />
	<img alt="Cloudflare" src="https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white" />
	<img alt="React" src="https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB" />
</p>


> **🏆 First-Place Winner — Best use of Google Gemini (MLH) at HackGT 2025**

Ming is an **AI-native, multi-agent L&D platform** that transform current and aspiring engineer to managers via practicing real-world workplace scenarios (performance reviews, conflict resolution, even layoffs) through **LLM-driven role-play** with detailed analysis and actionable feedback.

---

## Why Ming?

* **Bridge technical → managerial:** Upskill engineers into empathetic, effective managers—faster and more affordably than hiring externally.
* **Soft-skills that scale:** High-quality practice for communication, coaching, and conflict resolution—skills traditional trainings rarely teach well.
* **AI-economy ready:** As automation reshapes work, Ming helps people build durable, human-centered competencies.

---

## What it does

* **Role-played conversations** with LLM NPCs across tricky scenarios (reviews, conflicts, reorganizations, exits).
* **Real-time voice & signals:** Live **sentiment analysis**, pacing, interruptions, and conversational grounding.
* **Deep debriefs:** Annotated transcripts, strengths/areas to improve, and **personalized follow-ups**.
* **Adaptive curriculum:** New scenarios are generated from each user’s performance profile.

---

## Interface

<p align="center">
  <img width="55%" alt="image" src="https://github.com/user-attachments/assets/0be2cf90-415c-4a04-a52e-b4beb2eaa70a" />
</p>
<p align="center"><em>Our analysis page, with an annotated transcript, summary, and voice-integrated chat to receive further feedback.</em></p>

---

## How we built it

* **Frontend:** Next.js (App Router) + React, Tailwind, shadcn/ui
* **Orchestration:** **CedarOS** to integrate frontend with multi-agent runtime
* **Current backend:** Mastra with Gemini text and analysis by default (OpenAI selectable), OpenAI Live voice by default, and optional Deepgram speech-to-text/text-to-speech.
* **Local demo:** Next.js on localhost with a private Node/Mastra backend. The app opens directly without a login. See [local run details](docs/PRODUCTION.md).
* **Architecture:** Multi-agent LLMs coordinate roles (manager, employee, facilitator/coach) for realistic dynamics

---

## Quickstart

> **Prereqs:** Node 24 LTS and npm

```bash
npm ci
npm ci --prefix src/backend
cp .env.example .env
# Add GEMINI_API_KEY and OPENAI_API_KEY for the default providers.
npm run dev
```

Open `http://127.0.0.1:3000` (or `http://localhost:3000`). There is no login,
access password, or session-secret setup. `npm run dev` loads the root `.env`,
creates a temporary internal gateway token, and starts both services with the
same token. It does not change `.env` or print the token. Stop with **Ctrl+C**;
restart after changing `.env`.

Provider selection is independent:

| Setting | Default | Alternative |
| --- | --- | --- |
| `MING_TEXT_PROVIDER` | `gemini` — `GEMINI_API_KEY` | `openai` — `OPENAI_API_KEY` |
| `MING_VOICE_PROVIDER` | `openai` — `OPENAI_API_KEY` | `deepgram` — `DEEPGRAM_API_KEY` |

The defaults need both Gemini and OpenAI keys. To use Gemini + Deepgram, set
`MING_VOICE_PROVIDER=deepgram` and configure Gemini and Deepgram keys; an OpenAI
key is not needed. Restart `npm run dev` after changing providers. Missing keys
produce recoverable errors; the app never silently switches vendors.
`GEMINI_MODEL` and `OPENAI_TEXT_MODEL` override the text model. Gemini also accepts
`GOOGLE_GENERATIVE_AI_API_KEY`, then `GOOGLE_API_KEY`, when preceding keys are
unset or blank. The Veo helpers use the same server-side key precedence. The optional
`MING_BACKEND_URL` defaults to `http://127.0.0.1:4111`.
Leave `MING_APP_ORIGIN` unset for normal localhost use. A fixed
`MING_BACKEND_TOKEN` is only needed when running the services separately or
using the optional container setup.

The browser calls `/api/backend`; provider keys and the internal gateway token
stay on the server. `NEXT_PUBLIC_URL` is no longer used. This demo uses one
shared local identity and local conversation data. See [run details and remaining
dependency advisories](docs/PRODUCTION.md).

All backend text agents use the shared model in `src/backend/src/mastra/models.ts`.

Debriefs generate the summary and transcript annotations concurrently. The report
opens when its summary and scores are ready; transcript notes finish afterward
and can be retried independently. Annotations reference the original conversation
instead of asking the model to rewrite it. Successful stages and in-flight work
are reused for the same owner, session, transcript, context, provider, model, and
prompt version. Each stage cache holds at most 64 entries with a 15-minute TTL;
reuse is process-local and clears on backend restart. Bump `REPORT_PROMPT_VERSION`
when changing either report prompt or its generation settings. Backend
`debrief_generation` logs contain stage duration, success, and token counts, without
conversation text.

By default, voice conversations use OpenAI GPT-Live (`gpt-live-1`) over WebRTC. The root
`OPENAI_API_KEY` must belong to a project with GPT-Live access. Run on localhost
or HTTPS and allow microphone access when the chat opens. The voice connection
starts automatically with the microphone muted. Hold **Space** (outside the text
editor) or hold the microphone button to stream speech immediately; release only
mutes the microphone. Sending does not wait for release. The connection stays
open between presses. Use the phone button to end it.
**End Scenario** finishes voice transcription before generating the report.
The browser receives no OpenAI API key. Mastra supplies scenario facts and saves
the spoken transcript; typed chat, analysis, reports and delegated reasoning use
the selected text model.

With `MING_VOICE_PROVIDER=deepgram`, hold the microphone or Space to record one
utterance, then release to submit it. Deepgram transcribes the recording; the
selected text model generates Bart's reply; Deepgram speaks it. Unlike the Live
path, this mode waits for release before processing. It caps a recording at 30
seconds and preserves transcript text when speech playback fails. End Scenario
waits for the pending turn and saved transcript before generating feedback.
`DEEPGRAM_STT_MODEL` defaults to `nova-3`; `DEEPGRAM_TTS_MODEL` defaults to
`aura-2-orion-en`. Audio and provider keys go through the server.
Set `MING_TTS_PROVIDER=gemini` to speak Bart's replies with Gemini text-to-speech
instead (any other value keeps Deepgram, the default). It uses the same Gemini
key as text, `GEMINI_TTS_MODEL` (default `gemini-3.8-flash-lite-tts`) and
`GEMINI_TTS_VOICE` (default `Puck`), and streams raw 24 kHz PCM to the browser.
If Gemini fails before any audio (quota, network, no key, empty output), that
same reply is spoken by Deepgram instead; Deepgram STT and its key stay required.

The Google Veo video-generation helpers remain in `src/lib/videoUtil.ts` and
`src/backend/src/lib/videoUtil.ts`. Their existing scenario-to-video behavior is
preserved; they now read the Gemini key server-side rather than a `NEXT_PUBLIC_`
key. They are not invoked automatically during the conversation demo.

Run `npm run typecheck`, `npm run typecheck --prefix src/backend`, `npm run lint`,
`npm run test:voice`, `npm run test:providers`, `npm run test:deepgram`,
`npm run test:demo`, and the security tests in the CI workflow.
Builds enforce types and lint. Runtime smoke checks are documented in
[the local run guide](docs/PRODUCTION.md).

---

## Features (highlights)

* 🎭 **Multi-agent scenarios** with realistic personalities and constraints
* 🗣️ **Realtime voice** (speak to the NPCs; they speak back)
* 📈 **Live sentiment & signals** to nudge pacing and tone
* 🧠 **Strengths/weaknesses modeling** → **personalized next scenarios**
* 📝 **Annotated transcripts** with feedback and targeted micro-lessons
* ⚙️ **Pluggable scenarios** (JSON/YAML) for custom org content

---

## Challenges we solved

* **Cloudflare production split:** We initially bundled Next.js and the Mastra server into a single Wrangler target, then **split into two services** and pointed the Next.js server to Mastra—stabilizing deploys and edge runtime behavior.

---

## Inspiration

We want to help people **learn and build skills** that endure. Technical orgs need more managers who combine **deep engineering instincts** with **excellent people leadership**. Traditional trainings are generic and forgettable; Ming aims to be **hands-on, adaptive, and effective**.

---

## Tech stack

* **UI:** Next.js, React, Tailwind, shadcn/ui
* **AI/Agents:** Mastra, Google Gemini (default text), OpenAI Live (default voice), and optional OpenAI text / Deepgram STT and TTS
* **Orchestration:** CedarOS
* **Runtime:** Local Next.js and Node/Mastra; the original HackGT version used Cloudflare

---

## Roadmap

* 🧪 Stakeholder pilots & usability testing
* 🕊️ **Multi-party conversations** (e.g., mediating conflict between two coworkers)
* ⚡ **Ultra-low-latency** agent interactions
* 🥽 **Immersive AR/VR** practice environments
* 📱 Seamless **mobile** support
* 🔎 **Culture-aware scaling:** learn patterns within a company to tailor coaching


---

### Acknowledgements

* **Major League Hacking (MLH)** — Best use of Google Gemini Prize (HackGT 2025) 🏅
* Thanks to mentors, judges, and early testers for feedback!
