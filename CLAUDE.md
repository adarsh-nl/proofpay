# CLAUDE.md

All project rules live in **AGENTS.md**. Read it first and follow it exactly.

@AGENTS.md

Claude Code specifics:
- Your write scope: `src/server/**`, `src/app/api/**`, `src/shared/**` (contract-change rules apply), `tests/unit/**`, `scripts/**` (except `scripts/eval*.ts`), `drizzle/**`, `render.yaml`, `.github/**`.
- Loop: edit → `npm run check` → fix → repeat. Don't open a PR with failing checks.
- For PayPal endpoints, prefer the official docs linked in `docs/REFERENCES.md`. If the APIMatic PayPal context plugin or the PayPal MCP server is installed, use it to confirm request/response shapes.
- Never print or read `.env.local` into the conversation. Refer to vars by name.
- End every session with the hand-off template from AGENTS.md §10.
