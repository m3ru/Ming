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
* **Backend:** **Mastra** connected to **Google Gemini** (LLM + Sentiment Analysis)
* **Infra:** Deployed full-stack to **Cloudflare**, hosted on our own domain
* **Architecture:** Multi-agent LLMs coordinate roles (manager, employee, facilitator/coach) for realistic dynamics

---

## Quickstart

> **Prereqs:** Node 20+ and npm

```bash
# 1) Install root deps
npm i

# 2) Install backend deps
cd src/backend
npm i

# 3) Back to project root
cd ../../

# 4) Run dev servers
npm run dev
```

> Environment variables (example):
>
> * `GOOGLE_GENERATIVE_AI_API_KEY`, and `NEXT_PUBLIC_GOOGLE_GENERATIVE_AI_API_KEY` — required for LLM + sentiment
> * `OPENAI_API_KEY`, — for real-time STT and TTS
> * `NEXT_PUBLIC_URL*` — (optional) for connecting Frontend to Mastra Backend in production by providing Mastra Backend URL

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
* **AI/Agents:** Mastra, Google Gemini (LLM + Sentiment)
* **Orchestration:** CedarOS
* **Infra:** Cloudflare (Workers/Pages), custom domain

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
