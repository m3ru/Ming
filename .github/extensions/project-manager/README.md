# Ming project board

A Kanban board and dependency graph for Ming, ported from the HackMIT 2026
project manager and styled with Ming's "Director's notes" look.

- **Board:** columns are project areas and each card is a task. Stack order is
  priority; drag cards, or use the arrows and "Move to…".
- **Owners and agents:** every card has an owner (Sin, Meru, Ian, Renato or
  Unassigned) and the owner's agent in charge. An agent only works for its own
  owner, so changing a card's owner clears an agent that belongs to someone else.
- **Dependencies:** "+ waits on…" links a card to the cards it needs first.
  Unknown tasks, self-links and cycles are refused, and deleting a card removes
  it from every waiting list.
- **Status:** derived, never stored. A card is **Done**, **Ready** when
  everything it waits on is done, or **Blocked**.
- **Graph:** tasks are laid out left to right by how many steps of waiting stand
  before them. The highlighter marks the critical path, the longest chain of
  unfinished work, which sets the earliest finish. Dashed red lines are still
  waiting. Hover a task to trace what it waits on and what it unblocks; click to
  pin it and mark it done.
- **Owner focus:** select an owner chip to fade everyone else's work in both views.

The sample data is the team's HackGT 12 build (26–28 September 2025) as it
stood on Saturday at 9 pm, reconstructed from the commit history: who built
what, the AI tools they used, and whose work each piece waited on. Each owner picks from
the same agents (Copilot, Claude and Codex); about three quarters of the cards
ran through Copilot. Edit owners and agents in
`OWNERS` in `board.mjs`, and the plan in `data/board.json` or in the board itself.

## Open it

From the repository root:

```bash
node .github/extensions/project-manager/bin.mjs
```

It prints a `http://127.0.0.1:<port>/` URL. Add `#graph` to open the graph
first. `extension.mjs` also exposes the board as a GitHub Copilot canvas with
actions for owners, agents and dependencies. Neither the board nor the canvas
calls a model.

Every view reads and writes the same `data/board.json` under an exclusive lock,
with atomic replacement, and open views refresh live over SSE. A lock held for
more than five seconds makes an operation fail instead of overwriting another
writer. If a crash leaves `data/board.json.lock` behind, stop **all** board
processes before removing it.

Separate checkouts do not sync live: share board changes through Git like other
source, and stop board processes before pulling or editing the file by hand.

## Tests

```bash
node --test .github/extensions/project-manager/tests/board.test.mjs
```

Tests use temporary boards (`PROJECT_MANAGER_BOARD_PATH`) and child processes,
and never touch the committed board.
