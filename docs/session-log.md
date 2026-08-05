# Session Log

## 2026-08-05 (2) — execute_code regrade tool ignored the model's declared language

Surveyed: `docs/session-log.md`, `gh pr list` equivalent (no open PRs), `git log`, then a full `pnpm install && pnpm typecheck && pnpm test && pnpm build`. All green from a clean state this time — the Prisma pipeline fix from earlier today held up. Started local Postgres 16 + Redis in-sandbox (no docker daemon here either) to run the full integration suite, not just DB-independent tests: 66/66 passed.

Grepped for TODO/FIXME/HACK/PROD — only the two known, already-scoped PROD comments (`codeExecutor.ts` process-isolation caveat, `consistency.ts` heuristic-upgrade note already resolved by an earlier session) remained; neither is a fresh problem. Read through the auth/session/invite/batch/verdict routes and the two BullMQ workers (`processSignals.ts`, `regradeWorker.ts`) looking for genuine bugs, security gaps, or thin coverage.

Found one that cleared the bar: in `regradeWorker.ts`'s `dispatchTool`, the `execute_code` case extracted the model's fenced code block via regex but then called `executeCode(code, "javascript")` with the language **hardcoded**, ignoring whether the model had fenced the block as ` ```python ` or ` ```javascript `. Reproduced directly against the built `dist` output before touching anything: running `print(2 + 2)` through the hardcoded path threw `ReferenceError: print is not defined` (Node trying to parse Python), while running it correctly as `"python"` returned `4`. Since `execute_code` is the tool offered specifically for `domain === "code"` regrades, and code submissions are not uniformly JavaScript, this meant the tool's Python-verification path was silently broken for every code-domain regrade that used it — the agent would get a bogus JS error back instead of real execution output, no error visible anywhere in logs pointing at the root cause.

Shipped: added `extractCodeBlock()` to `codeExecutor.ts` (a small pure helper that captures the fence's declared language, defaulting to `javascript` only when unlabeled) and used it in `dispatchTool` instead of the hardcoded string; the `regrade_tool_call` event's published `input.language` now reflects the real language too. Added `apps/api/tests/codeExecutor.test.ts` (6 new tests): unit coverage for `extractCodeBlock`'s detection across python/javascript/unlabeled/no-fence, plus two integration tests that actually run a Python and a JS snippet through `executeCode` and assert on real stdout — this is the first test coverage `codeExecutor.ts` has ever had. Verified with `pnpm typecheck` (clean), `pnpm test` (72/72, was 66), and `pnpm build` (clean), all against the same local Postgres+Redis setup.

Merged: [PR #3](https://github.com/akkinallani/assay/pull/3) via squash merge. CI (`check` + `GitGuardian Security Checks`) green before merge — this is the first PR since this morning's CI-repair session, confirming that fix holds for a real PR end-to-end.

Considered and rejected: the web bundle-size warning (`dist/assets/index-*.js` at 590KB) surfaced in every build — purely a perf/cosmetic nice-to-have with no demonstrable user-facing breakage today, so it doesn't clear the bar; the `codeExecutor.ts` PROD comment about full container isolation (gVisor/Firecracker) — real gap but a "future need" architectural addition, not a fix to something concretely broken right now, and adding a sandboxing layer would be a large new dependency, not the smallest diff; nothing else surveyed looked broken enough to act on, so the loop stopped at one item for this run.

Same branch-deletion limitation as this morning: raw `git push origin --delete` on the merged branch (`agent/execute-code-language-detect-2026-08-05-1`) still 403s from this sandbox; the branch is merged with no unmerged work, just left dangling on GitHub for a future session/the user to clean up via the UI.

## 2026-07-29 — Initial build

Built full Phase 0–4 from scratch.

Decisions:
- pnpm workspaces over npm/yarn: faster installs, strict hoisting prevents phantom deps
- Turbo for task orchestration: dependency graph respects schema→engine→api/web build order
- tsx for API dev server: zero-config TS execution without a build step in dev
- BullMQ over simple setInterval: retry semantics and persistence matter for agent re-grade jobs
- Rule-based consistency/coverage signals in Phase 2: LLM upgrade path marked with PROD comments
- Code executor uses child_process with timeout; PROD comment marks containerization requirement
- Re-grade agentic loop capped at 10 turns per item; cost logged per call
- API key auth only (demo); PROD comment marks real multi-tenant auth

## 2026-07-30 — Ollama migration, live run view, hardening pass

- Swapped Anthropic API for local Ollama (`llama3.1` chat, `nomic-embed-text` embeddings) — no API key/billing dependency; removed the unused `@anthropic-ai/sdk` dependency entirely
- Added upload flow (`POST /batches`, already existed but was never wired to the UI) + a live run view: SSE endpoint (`GET /batches/:id/live`) backed by Redis pub/sub, publishing per-turn/per-tool-call/per-unit events from the regrade worker so users can watch their own uploaded data get graded in real time instead of only seeing static seeded results
- Fixed a real regrade-loop bug: a fallback branch pushed a corrective "please provide JSON" message and then immediately `break`, so the message was queued but never sent — the loop could only ever use 1 of its 10 allotted turns. Removing the early `break` plus a forced final-turn reminder (no tools, JSON-only) fixed previously-unparseable code-domain regrades
- Replaced the `contextRetrieval.ts` keyword-substring stub with real embedding-based cosine similarity (PROD comment resolved) — verified with a query sharing zero literal words with the correct source passage, which still ranked first
- Hardened `codeExecutor.ts` (PROD comment: still not full container isolation, but closes concrete gaps): scrubs environment variables before exec (previously every DB/API secret was inherited by LLM-generated code), uses Node's built-in `--permission` model for JS (blocks filesystem writes/reads outside the run dir and child-process spawning — verified these are actually enforced, not just configured), and Python `-I` isolated mode
- Added test coverage that didn't exist before: `regradeSignal`/`scorer.ts` edge cases in `packages/engine` (19 tests), and `apps/api`'s first test suite for the ingestion validator (11 tests)
- Fixed duplicate-work-unit-id uploads 500ing with a raw Prisma stack trace — now a clean transactional 409 with a client-side "retry with unique ids" recovery action
- Resolved the consistency signal's PROD comment (`packages/engine/src/signals/consistency.ts:33`) with a real LLM audit, bounded to a random sample of up to 5 heuristic-passed items per batch (`CONSISTENCY_SPOT_CHECK_CAP` in `processSignals.ts`) so ingest time doesn't scale with batch size — the free heuristic stays primary. Verified against a case the heuristic structurally cannot catch (mid-range score, so its extreme-score-only trigger never even runs): a 70%-scored answer with a fabricated fact, phrased with none of the heuristic's fixed word list. The LLM audit flagged it, which triggered a regrade, which correctly identified the actual error — full pipeline, not just the one signal

## 2026-08-05 — Fresh-clone pipeline break (Prisma) + CI repair

Surveyed: `docs/session-log.md`, `gh pr list` equivalent (no open PRs), `git log`, then `pnpm install && pnpm typecheck && pnpm test && pnpm build` at session start. Typecheck and test both failed hard across nearly all of `apps/api` — `tsc` errors like `Property 'PrismaClientKnownRequestError' does not exist on type 'typeof Prisma'` and `Module '"@prisma/client"' has no exported member 'User'`, and vitest failing 9 of 15 suites with `@prisma/client did not initialize yet`.

Decided: this was the highest-leverage, lowest-risk fix available — a genuinely fresh clone could not typecheck, test, or (partially) build at all, which blocks onboarding, CI, and every future agent session, not just cosmetic debt. Root cause: `apps/api/prisma/schema.prisma` lives at a non-default path, so `@prisma/client`'s own postinstall can't find it and silently no-ops (warns, doesn't fail); nothing else in the repo (no root postinstall, no turbo task dependency, no CI step) ever ran `prisma generate`. A `db:generate` script existed but was wired to nothing.

Shipped: added a `generate` script to `apps/api/package.json`, wired it as a turbo task that `build`/`typecheck`/`test`/`dev` depend on (self-heals without a full reinstall), and added a root `postinstall` so a bare `pnpm install` produces a working client immediately. Verified with a fully clean `node_modules` + `.turbo` cache: typecheck, build, and all 66 tests (15 suites) passed, run against a real local Postgres + Redis (started manually in-sandbox — no docker daemon available here) to exercise the full integration suite, not just DB-independent unit tests.

Along the way, discovered CI on `main` was itself broken (same failure on the last push to main, predating this change): `pnpm/action-setup@v4`'s current release hard-fails with `ERR_PNPM_BAD_PM_VERSION` when both its `version` input and `package.json`'s `packageManager` field specify a pnpm version. Fixing that exposed a second, previously-masked issue: pnpm 11 (pinned via `packageManager`) requires Node ≥22.13, but `setup-node` was pinned to `node-version: 20` — an outright incompatibility that only worked in this sandbox because it happens to run Node 22. Fixed both as part of the same PR (removed the redundant `version: 11` input; bumped `node-version` to 22) since they blocked this PR's own CI from validating anything, and every future PR's CI too.

Also ran into (and got resolved mid-session): the GitHub write path was denied on the first ship attempt — both raw `git push` (403 straight from github.com) and the GitHub MCP tools (`create_branch` → `403 Resource not accessible by integration`) failed, while reads worked fine. Root cause turned out to be that the "Claude" GitHub App was OAuth-authorized on the account but never actually **installed** with repo/write permissions (visible under GitHub's Authorized GitHub Apps tab: "Claude has not been installed on any accounts you have access to"). The user fixed this on GitHub's side; write access via the GitHub MCP tools (`create_branch`/`push_files`/PR creation/merge) confirmed working afterward. Raw `git push` from this sandbox still 403s separately and remains unusable — the GitHub MCP tools are the working path and should be preferred going forward regardless.

Merged: [PR #1](https://github.com/akkinallani/assay/pull/1) via squash merge, 3 commits (Prisma pipeline fix + 2 CI fixes). CI green (`check` + `GitGuardian Security Checks`) before merge.

Note: no tool in this session can delete a remote branch (no delete-ref/delete-branch MCP tool; raw `git push --delete` 403s the same way plain `git push` does). Two stale branches are left on GitHub as a result: `agent/permission-check-2026-08-05` (an empty diagnostic branch from the permission investigation, safe to delete) and `agent/wire-prisma-generate-2026-08-05-1` (now merged, GitHub's own "delete branch on merge" didn't appear to be enabled for this repo). A future session with branch-delete capability (or the user, via GitHub's UI) can clean these up; they carry no unmerged work.
