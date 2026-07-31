# Session Log

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
