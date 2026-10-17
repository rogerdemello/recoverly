# Agent notes for Recoverly

Read [docs/technical-spec.md](docs/technical-spec.md) first; it is the build contract. Authority order when documents disagree: technical-spec, then ui-and-drafting-spec, then the product spec.

## Commands

- `npm run typecheck` and `npm test` must pass before any commit (tests need no network).
- `npm run test:sandbox`, `npm run smoke -- <url>` and `npm run analyze` use real credentials from `.env`.
- After changing `sandbox/recoverly_lib.py` or `sandbox/replay/*.py`, run `npm run capture:golden` and review the diff in `tests/fixtures/golden-*.json` against `docs/fixture-spec.md`.

## Rules

- Never print, log or commit secrets. `.env`, `.env.*` (except `.env.example`), `.projects/` and `.recoverly/` are git-ignored.
- The scoring rules live only in `sandbox/recoverly_lib.py`. The TypeScript side validates sandbox output (`src/lib/agent/validate.ts`) and never re-scores.
- The LLM never receives customer records, emails, scores or failure codes of a specific customer. Prompts carry schema, constants and the question only.
- The API has no side-effect action (no charge, retry, cancel or send). Approval records a decision; delivery needs `RECOVERLY_ENABLE_SEND=true` and an adapter, and none ships.
- Keep the replay script's embedded plan identical to `DEMO_PLAN` in `src/lib/domain/schemas.ts` (a test enforces it).
- Amounts are integer minor units. Never sum across currencies.
- Imported and generated content is untrusted: render with React escaping only, never `dangerouslySetInnerHTML`.
