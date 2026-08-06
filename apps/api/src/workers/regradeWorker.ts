import { Worker, Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { WorkUnit, AgentRegradeResult } from "@quorum/schema";
import { regradeSignal, buildVerdict, checkRubricCoherence } from "@quorum/engine";
import { llmCall, type LlmTool, type MessageParam } from "../llm/index.js";
import { llmCallStructured, LlmParseError } from "../llm/structured.js";
import { regradeGradeSchema } from "../llm/schemas.js";
import { executeCode, extractCodeBlock } from "../llm/tools/codeExecutor.js";
import { verifyMathClaim } from "../llm/tools/mathVerify.js";
import { retrieveContext } from "../llm/tools/contextRetrieval.js";
import { checkFacts } from "../llm/tools/factCheck.js";
import { publishEvent, refreshBatchProgress } from "../events/bus.js";
import type { Redis } from "ioredis";

export const regradeQueue = (redis: Redis) =>
  new Queue("regrade", { connection: redis });

const REGRADE_SYSTEM = `You are an expert grader performing an independent quality assessment.
You will be given a task, a rubric, and a model output to grade.
You may use the available tools to verify claims — you can use more than one if it's useful, but don't use tools you don't need.
When asked for your final grade, you must score every rubric criterion individually as well as give an overall score.`;

let currentJob: { batchId: string; workUnitId: string } | null = null;

export function getCurrentRegradeJob() {
  return currentJob;
}

function domainTools(domain: string): LlmTool[] {
  // fact_check is available in every domain — general claim verification against supplied
  // context/attachments isn't specific to any one grading domain.
  const tools: LlmTool[] = [
    {
      name: "fact_check",
      description: "Extract factual claims from the model output and check them against the task and any attachments",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
  ];

  if (domain === "code") {
    tools.push({
      name: "execute_code",
      description: "Execute JavaScript or Python code and return the output",
      input_schema: {
        type: "object" as const,
        properties: {
          code: { type: "string", description: "Code to execute" },
          language: { type: "string", enum: ["javascript", "python"] },
        },
        required: ["code"],
      },
    });
  }

  if (domain === "math") {
    tools.push({
      name: "verify_math",
      description: "Verify a mathematical claim or computation",
      input_schema: {
        type: "object" as const,
        properties: {
          claim: { type: "string" },
          context: { type: "string" },
        },
        required: ["claim", "context"],
      },
    });
  }

  if (domain === "law" || domain === "safety") {
    tools.push({
      name: "retrieve_context",
      description: "Search the provided attachments for relevant passages",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    });
  }

  return tools;
}

function detectRequestedTool(content: string, tools: LlmTool[]): LlmTool | null {
  return tools.find((t) => content.includes(t.name)) ?? null;
}

async function dispatchTool(
  tool: LlmTool,
  content: string,
  unit: WorkUnit,
  rubricText: string,
  ctx: { redis: Redis; batchId: string; workUnitId: string; turn: number; toolOutputs: Array<{ tool: string; output: string }> }
): Promise<string> {
  switch (tool.name) {
    case "execute_code": {
      const block = extractCodeBlock(content);
      if (!block) {
        return "I couldn't find a fenced code block to execute. Put the code in a ```javascript``` or ```python``` block, or move on to your final grade.";
      }
      const execResult = await executeCode(block.code, block.language);
      const output = `stdout: ${execResult.stdout}\nstderr: ${execResult.stderr}\nexitCode: ${execResult.exitCode}`;
      ctx.toolOutputs.push({ tool: "execute_code", output });
      await publishEvent(ctx.redis, ctx.batchId, {
        type: "regrade_tool_call",
        batchId: ctx.batchId,
        workUnitId: ctx.workUnitId,
        turn: ctx.turn,
        tool: "execute_code",
        input: { code: block.code, language: block.language },
        output,
      });
      return output;
    }
    case "verify_math": {
      const context = `${unit.task}\n\n${rubricText}`;
      const verifyResult = await verifyMathClaim(content, context, ctx.workUnitId);
      const output = `correct: ${verifyResult.correct}\nexplanation: ${verifyResult.explanation}`;
      ctx.toolOutputs.push({ tool: "verify_math", output });
      await publishEvent(ctx.redis, ctx.batchId, {
        type: "regrade_tool_call",
        batchId: ctx.batchId,
        workUnitId: ctx.workUnitId,
        turn: ctx.turn,
        tool: "verify_math",
        input: { claim: content, context },
        output,
      });
      return output;
    }
    case "retrieve_context": {
      const query = unit.task;
      const retrieved = await retrieveContext(query, unit.attachments ?? []);
      const output =
        retrieved.length > 0
          ? retrieved.map((r) => `[${r.source}] ${r.text}`).join("\n\n")
          : "No relevant context found in attachments.";
      ctx.toolOutputs.push({ tool: "retrieve_context", output });
      await publishEvent(ctx.redis, ctx.batchId, {
        type: "regrade_tool_call",
        batchId: ctx.batchId,
        workUnitId: ctx.workUnitId,
        turn: ctx.turn,
        tool: "retrieve_context",
        input: { query },
        output,
      });
      return output;
    }
    case "fact_check": {
      const factResult = await checkFacts(unit.modelOutput, unit.task, unit.attachments ?? [], ctx.workUnitId);
      const output =
        factResult.claims.length > 0
          ? factResult.claims.map((c) => `[${c.verdict}] ${c.claim} — ${c.evidence}`).join("\n")
          : "No checkable factual claims found.";
      ctx.toolOutputs.push({ tool: "fact_check", output });
      await publishEvent(ctx.redis, ctx.batchId, {
        type: "regrade_tool_call",
        batchId: ctx.batchId,
        workUnitId: ctx.workUnitId,
        turn: ctx.turn,
        tool: "fact_check",
        input: { text: unit.modelOutput },
        output,
      });
      return output;
    }
    default:
      return "Unknown tool.";
  }
}

export function createRegradeWorker(prisma: PrismaClient, redis: Redis) {
  return new Worker(
    "regrade",
    async (job) => {
      const { workUnitId, batchId } = job.data as { workUnitId: string; batchId: string };
      currentJob = { batchId, workUnitId };
      let tenantId: string | undefined;

      try {
        // The job is enqueued with `attempts: 3` (see processSignals.ts). If a transient failure
        // (e.g. a Redis blip in one of the publishEvent calls below) throws *after* the DB
        // transaction further down has already committed the "regrade" signal and incremented
        // GraderStat, BullMQ retries the whole handler from scratch — re-running the expensive LLM
        // grading loop and writing a second, duplicate signal row plus a second increment. Bail out
        // early if this unit was already regraded so a retry can't double-write.
        const alreadyRegraded = await prisma.signal.findFirst({ where: { workUnitId, key: "regrade" } });
        if (alreadyRegraded) {
          console.warn(`Skipping regrade for ${workUnitId}: a "regrade" signal already exists (retried job)`);
          await publishEvent(redis, batchId, { type: "unit_status", batchId, workUnitId, status: "graded" });
          return;
        }

        const dbUnit = await prisma.workUnit.findUniqueOrThrow({ where: { id: workUnitId } });
        tenantId = dbUnit.tenantId;
        const unit: WorkUnit = {
          ...dbUnit,
          rubric: dbUnit.rubric as unknown as WorkUnit["rubric"],
          grade: dbUnit.grade as unknown as WorkUnit["grade"],
          attachments: dbUnit.attachments as unknown as WorkUnit["attachments"],
          domain: dbUnit.domain as WorkUnit["domain"],
          createdAt: dbUnit.createdAt.toISOString(),
          timeSpentSec: dbUnit.timeSpentSec ?? undefined,
        };

        await publishEvent(redis, batchId, { type: "unit_status", batchId, workUnitId, status: "regrading" });

        const tools = domainTools(unit.domain);
        const toolOutputs: Array<{ tool: string; output: string }> = [];

        const rubricText = unit.rubric
          .map((c) => `- [${c.required ? "REQUIRED" : "optional"}] ${c.text}${c.weight ? ` (weight: ${c.weight})` : ""}`)
          .join("\n");
        const rubricWithIds = unit.rubric
          .map((c) => `- id="${c.id}" [${c.required ? "REQUIRED" : "optional"}] ${c.text}`)
          .join("\n");

        const userPrompt = `Task:\n${unit.task}\n\nModel Output to Grade:\n${unit.modelOutput}\n\nRubric:\n${rubricText}\n\nInvestigate as needed using the available tools, then grade this output carefully using the rubric.`;

        const messages: MessageParam[] = [{ role: "user", content: userPrompt }];

        const maxToolTurns = 6;
        for (let turn = 0; turn < maxToolTurns; turn++) {
          const result = await llmCall({
            model: process.env.OLLAMA_MODEL ?? "llama3.1",
            system: REGRADE_SYSTEM,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            maxTokens: 2048,
            jobId: workUnitId,
          });

          await publishEvent(redis, batchId, { type: "regrade_turn", batchId, workUnitId, turn, content: result.content });
          messages.push({ role: "assistant", content: result.content });

          const requestedTool = detectRequestedTool(result.content, tools);
          if (!requestedTool) break;

          const toolOutput = await dispatchTool(requestedTool, result.content, unit, rubricText, {
            redis,
            batchId,
            workUnitId,
            turn,
            toolOutputs,
          });
          messages.push({ role: "user", content: `Tool result:\n${toolOutput}\n\nContinue your investigation, or provide your final grade.` });
        }

        messages.push({
          role: "user",
          content: `Give your final grade now. Score every rubric criterion below individually by its id, then give an overall score.\n\nRubric (reference each by its id):\n${rubricWithIds}\n\nRespond with a JSON object of this exact shape:\n{"score": number, "maxScore": number, "reasoning": "detailed explanation citing specific evidence", "criteriaScores": [{"criterionId": "<id from the rubric above>", "met": boolean, "justification": "one sentence"}]}`,
        });

        let parsed;
        try {
          parsed = await llmCallStructured({
            model: process.env.OLLAMA_MODEL ?? "llama3.1",
            system: REGRADE_SYSTEM,
            messages,
            schema: regradeGradeSchema,
            maxTokens: 2048,
            jobId: workUnitId,
          });
        } catch (err) {
          if (err instanceof LlmParseError) {
            console.warn(`Could not parse regrade result for ${workUnitId}: ${err.message}`);
            await publishEvent(redis, batchId, {
              type: "regrade_error",
              batchId,
              workUnitId,
              message: "Could not parse a final grade from the agent's response",
            });
            await publishEvent(redis, batchId, { type: "unit_status", batchId, workUnitId, status: "error" });
            // This job completes successfully (no BullMQ retry) but never wrote a "regrade"
            // signal — computeBatchProgress's regradeDone count would wait for one forever,
            // permanently stranding the batch at "pending". Write a fired:false marker so the
            // unit counts as "accounted for" without affecting risk scoring (scoreSignals only
            // sums fired signals) or the accuracy breakdown (which only counts fired ones too).
            // The unit's original verdict/risk is left untouched — it still genuinely needs a
            // human look, just without the agent's second opinion.
            await prisma.signal.create({
              data: {
                tenantId: unit.tenantId,
                workUnitId,
                key: "regrade",
                fired: false,
                weight: 0,
                evidence: "Agent regrade could not produce a parseable final grade — needs manual review",
              },
            });
            return;
          }
          throw err;
        }

        const humanPct = unit.grade.score / unit.grade.maxScore;
        const agentPct = parsed.score / parsed.maxScore;
        const coherence = checkRubricCoherence(unit.rubric, parsed.criteriaScores, parsed.score, parsed.maxScore);

        const agentResult: AgentRegradeResult = {
          agentScore: parsed.score,
          agentMaxScore: parsed.maxScore,
          agentReasoning: parsed.reasoning,
          toolOutputs,
          divergence: Math.abs(humanPct - agentPct),
          criteriaScores: parsed.criteriaScores,
          coherenceIssues: coherence.issues.length > 0 ? coherence.issues : undefined,
        };

        const signal = regradeSignal(unit, agentResult);

        const existingSignals = await prisma.signal.findMany({ where: { workUnitId } });
        const allSignals = [
          ...existingSignals.map((s) => ({
            key: s.key as "consistency" | "coverage" | "cohort" | "regrade",
            fired: s.fired,
            weight: s.weight,
            evidence: s.evidence,
            detail: s.detail as unknown,
          })),
          signal,
        ];

        const updatedVerdict = buildVerdict(workUnitId, allSignals);

        await prisma.$transaction([
          prisma.signal.create({
            data: {
              tenantId: unit.tenantId,
              workUnitId,
              key: signal.key,
              fired: signal.fired,
              weight: signal.weight,
              evidence: signal.evidence,
              detail: signal.detail ? (signal.detail as object) : undefined,
            },
          }),
          prisma.verdict.update({
            where: { workUnitId },
            data: { risk: updatedVerdict.risk, recommendation: updatedVerdict.recommendation },
          }),
          prisma.graderStat.updateMany({
            where: { tenantId: unit.tenantId, graderId: unit.graderId },
            data: { regradeCount: { increment: 1 }, agreementCount: { increment: signal.fired ? 0 : 1 } },
          }),
        ]);

        await publishEvent(redis, batchId, {
          type: "regrade_complete",
          batchId,
          workUnitId,
          agentScore: agentResult.agentScore,
          agentMaxScore: agentResult.agentMaxScore,
          agentReasoning: agentResult.agentReasoning,
          divergence: agentResult.divergence,
        });
        await publishEvent(redis, batchId, { type: "unit_status", batchId, workUnitId, status: "graded" });
      } catch (err) {
        await publishEvent(redis, batchId, {
          type: "regrade_error",
          batchId,
          workUnitId,
          message: err instanceof Error ? err.message : String(err),
        });
        await publishEvent(redis, batchId, { type: "unit_status", batchId, workUnitId, status: "error" });

        // BullMQ retries this job up to job.opts.attempts times (see processSignals.ts). Only
        // on the last allowed attempt — no more retries coming — write the same fired:false
        // terminal marker as the LlmParseError case above, so a unit that fails every attempt
        // (e.g. the LLM backend is down) doesn't strand the batch at "pending" forever the same
        // way an unparseable grade would. job.attemptsMade only counts *prior* failures (this
        // attempt isn't recorded until after this handler returns/throws), so it equals
        // maxAttempts - 1 on the final attempt. Skip if tenantId was never resolved (the unit
        // itself failed to load) or a "regrade" signal already exists (the real transaction
        // committed before a later step in *this* attempt threw — already handled correctly).
        const maxAttempts = job.opts.attempts ?? 1;
        if (tenantId && job.attemptsMade + 1 >= maxAttempts) {
          const alreadyRecorded = await prisma.signal.findFirst({ where: { workUnitId, key: "regrade" } });
          if (!alreadyRecorded) {
            await prisma.signal.create({
              data: {
                tenantId,
                workUnitId,
                key: "regrade",
                fired: false,
                weight: 0,
                evidence: "Agent regrade failed on every retry — needs manual review",
              },
            });
          }
        }

        throw err;
      } finally {
        currentJob = null;
        // Best-effort: republishes fresh batch stats (and flips status to "done" once every
        // flagged item is accounted for) after every outcome, success or failure, so the live
        // view's counts and completion banner actually update instead of freezing at whatever
        // they were when process-signals finished. Swallowed so a refresh failure here can't
        // mask the real job outcome above.
        await refreshBatchProgress(prisma, redis, batchId).catch((err) => {
          console.warn(`Failed to refresh batch progress for ${batchId}:`, err);
        });
      }
    },
    { connection: redis, concurrency: 1 }
  );
}
