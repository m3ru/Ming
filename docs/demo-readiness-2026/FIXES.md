# Demo blocker fixes — 2026-10-24

Local changes only. No commit, push, deployment, credential changes, or real AI calls.

## Delivered

- **Provider failure recovery:** missing credentials return HTTP 503 before model execution; stream errors and empty replies fail explicitly instead of reporting completion. The real installed Mastra runtime survives failure followed by a healthy synthetic request. Submitted user text is saved once even when generation fails. Transcript debug logging was removed. Both incompatible Mastra tracing paths are disabled pending a tested upgrade.
- **Reliable text fallback:** native Tab traversal, visible text input below 1024 px, accessible Send button, accurate voice state guidance. HTTP errors, streamed errors, empty replies, and partial failed replies preserve the draft. Recovery observes Cedar's swallowed transport errors and waits for its asynchronous message handlers.
- **Truthful End Scenario:** requires genuine user/assistant dialogue; excludes interface errors, tools and failed partial replies. Report generation has an in-flight guard, a 120-second request timeout, cancellation and recoverable errors. A successful HTTP/workflow result must still contain a readable overview and annotated segment before saving or recording completion. Unknown ratings remain unknown. Cancelling stops the client request; it does not guarantee cancellation of server-side model work already running.
- **Truthful reports and progress:** removed sample transcript and invented score fallbacks. Safe Markdown rendering replaces raw HTML. Missing, malformed and partial reports have explicit states. Scores on the report, dashboard and coach context agree. Completion records are versioned and deduplicated by conversation ID; page visits, visibility changes and retries no longer add completions. Old untrustworthy visit counters and cached fabricated scores are ignored. Coaching restores the original scenario thread when leaving its panel.
- **Persona consistency:** live Bart instructions now match the scenario's humble, apologetic persona. Home copy no longer promises an unimplemented scenario-unlock mechanism.

## Verification

| Check | Result |
|---|---|
| `npm run test:demo` | 31/31 pass |
| `npm run test:voice` | 19/19 pass |
| `npm run build` | Production Next build passes |
| `npm --prefix src/backend run build` | Production Mastra build passes |
| `node tests/backend-built-smoke.mjs` | Actual built backend returns two HTTP 503 `AI_NOT_CONFIGURED` responses and stays alive |
| Backend TypeScript | Pass |
| Scoped frontend ESLint | Pass for report, controls, new helpers, progress and achievements |
| Full frontend TypeScript | Same 8 pre-existing errors in CommandBar and unused legacy ChatInput; no new diagnostics |
| `git diff --check` | Pass |

Backend regressions use the real installed Mastra runtime with a synthetic model, isolated memory, and zero network calls. Controls regressions include the actual installed Cedar store with a synthetic SSE response, including partial text followed by an error. Report tests cover empty/error/partial rendering, null scores, safe Markdown, and thread cleanup.

## Codex browser evidence

Tested the production Next server in the Codex in-app browser at 1280×720 and 960×600. The explicit test-only server `tests/demo-browser-fixture.mjs` supplied deterministic failures and clearly labelled synthetic reports; it is not part of the app or its normal scripts.

Verified HTTP failure → streamed failure → successful resend without reload; draft retention; native Tab focus; visible compact text controls; empty-conversation rejection; report failure, malformed success and cancellation recovery; successful report navigation; no count increase on report revisits; interrupted partial replies blocked from evaluation; missing ratings displayed as **Not scored**; and original scenario restoration after coaching. A second genuine test conversation increased the count from one to two; regenerating its report kept the count at two.

- [Recorded checks and actual synthetic transcript payload](evidence/fixed-browser-result.json)
- [Empty report](evidence/fixed-report-empty.jpg)
- [Recoverable HTTP failure at 960×600](evidence/fixed-http-error-960.jpg)
- [Successful synthetic report](evidence/fixed-report-success.jpg)
- [Partial response cannot finish a scenario](evidence/fixed-partial-reply-blocked.jpg)
- [Unknown ratings remain unknown](evidence/fixed-report-unknown-scores.jpg)
- [Verified progress](evidence/fixed-completion.jpg)

## Still required before stage / public release

1. **Credentialed stage rehearsal:** no `OPENAI_API_KEY` was configured and the browser microphone was denied. Actual voice connection, speech quality, interruption timing, real model output format/quality, latency and the stage deployment URL are unverified. Run the exact chosen scenario with the actual laptop, microphone and venue network; rehearse the text fallback and capture a backup recording.
2. **Public exposure remains blocked by the original security findings:** unpatched Next dependency advisory, unauthenticated backend/memory surface, and deployment/session-persistence design. See [original audit](READINESS.md). These local demo fixes do not certify production security or deployability.
3. **Quality-gate cleanup remains:** eight existing frontend TypeScript errors and the original broader lint debt; production builds still skip those checks by configuration.
4. **Optional adaptive next-scenario flow remains deferred.** The rehearsed flow is Bart conversation → report. Other scenario cards remain unavailable. A continued conversation counts once until a fresh session; there is no dedicated reset/new-session control yet.
5. Browser test reports and counts were synthetic and saved only to the local QA browser origin. Test servers are stopped after verification so the fixture cannot be mistaken for a real provider.
