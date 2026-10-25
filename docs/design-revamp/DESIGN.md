# Ming redesign: "Director's notes, clean"

You rehearse a hard conversation the way actors rehearse a scene. The interface is clean, light product UI on script paper. One signature runs through it: **highlighter and handwritten coaching notes**. Spend boldness there; keep everything else quiet.

Approved mockups (look and feel only; they invent people, nav items, timestamps and features that do not exist; never build those):
- Dashboard: `h4-dashboard-directors-notes-clean.png`
- Call screen: `h2-call-directors-notes-clean.png`
- Report: `h5-report-directors-notes-clean.png`

## Tokens (already in `src/app/globals.css`; use these, never raw hex or Tailwind gray/slate/blue)
| Token (Tailwind) | Value | Use |
|---|---|---|
| `bg-paper` / `bg-background` | #F2F3EF | page canvas |
| `bg-card` / `bg-white` | #FFFFFF | panels |
| `text-ink` / `text-foreground` | #2E3135 | body and headings |
| `text-ink-soft` / `text-muted-foreground` | #5E636A | secondary text |
| `border-rule` / `border-border` | #DADCD4 | hairlines (1px; dashed allowed for "script margin" dividers) |
| `bg-highlight` | #FFE55C | highlighter |
| `pencil` (`bg-primary`, `text-pencil`) | #3557C8 | the one accent: primary buttons, links, positive handwritten notes |
| `red-pencil` (`text-red-pencil`, `bg-destructive`) | #C43D3D | critical notes, ending the call, errors |
| `sage` | #2E7D69 | score bars, "what went well" |
| `tense` → `warm` | #7B8CFF → #FFB547 | only the tone gauge gradient |

Radius: panels `rounded-xl`, controls `rounded-lg`, chips `rounded-full`. No drop shadows on panels (hairline borders instead); only the video tile and floating overlays may cast a soft shadow.

## Type
- `font-sans` = Schibsted Grotesk (loaded in layout). Headlines are heavy (`font-extrabold`/`font-black`, tight tracking); UI text 400–600.
- `.hand` = Caveat, the handwritten coaching voice. Use at 20–28px so it reads on a stage screen. Use it sparingly: at most one or two notes per screen, except the report's transcript margin notes, which are the signature.
- Utilities: `.marker` (inline highlighter on a phrase), `.swipe` (highlighter swipe behind a headline), `.hand` (handwriting).

## Rules
- Sentence case everywhere: buttons, headings, labels. No ALL-CAPS tracked eyebrow labels, no monospace labels, no "→" glyphs appended to button text.
- Copy names things the way users do. No provider or plumbing names in the UI (no "Deepgram", "OpenAI Live", "Cedar").
- Honest data only: never show highlights, notes, timestamps or names that the app does not actually have.
- Keep keyboard focus visible (global `:focus-visible` already set), respect reduced motion (global), and keep text contrast ≥ 4.5:1.
- Motion (revised at the user's request: "animation transition needs to be improved a lot"): every state change animates so the app feels alive: voice listening, processing, Bart speaking, message arrival, panels opening, overlays, errors, page changes. Keep it purposeful and quick (150–450ms, ease-out or a slight spring), never decorative loops on idle content, and always respect `prefers-reduced-motion` (a global CSS rule already neutralises CSS animations; for `motion/react` use `useReducedMotion` where a loop would otherwise run).
- Shared pieces in `globals.css`: `.alert-note` (compact red-pencil error callout with a pop-in), `.enter-pop`, `.enter-up`, keyframes `ming-pop` and `ming-up`, and cross-document view transitions for full-page navigations.
- Errors: one short sentence that says what happened and what to do, a red-pencil icon, and the recovery action as a button or link right there. No paragraphs, no apologies, no "please".
