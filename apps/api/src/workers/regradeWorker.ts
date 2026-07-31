import { Worker, Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { WorkUnit, AgentRegradeResult } from "@quorum/schema";
import { regradeSignal, buildVerdict } from "@quorum/engine";
import { llmCall } from "../llm/index.js";
import { executeCode } from "../llm/tools/codeExecutor.js";
import { verifyMathClaim } from "../llm/tools/mathVerify.js";
import { retrieveContext } from "../llm/tools/contextRetrieval.js";
import { publishEvent } from "../events/bus.js";
import type { Redis } from "ioredis";
import type { LlmTool } from "../llm/index.js";

export const regradeQueue = (redis: Redis) =>
  new Queue("regrade", { connection: redis });

const REGRADE_SYSTEM = `You are an expert grader performing an independent quality assessment.
You will be given a task, a rubric, and a model output to grade.
Use the available tools to verify claims where applicable, but use at most one tool call before grading.
Your final message must be ONLY the JSON grade, with no other text before or after it:
{"score": number, "maxScore": number, "reasoning": "detailed explanation citing specific evidence"}`;

const FINAL_TURN_REMINDER =
  'This is your last turn. Respond with ONLY the JSON grade and nothing else — no tool calls, no explanation outside the JSON: {"score": number, "maxScore": number, "reasoning": "..."}';

let currentJob: { batchId: string; workUnitId: string } | null = null;

export function getCurrentRegradeJob() {
  return currentJob;
}

function domainTools(domain: string): LlmTool[] {
  const tools: LlmTool[] = [];

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

export function createRegradeWorker(prisma: PrismaClient, redis: Redis) {
  return new Worker(
    "regrade",
    async (job) => {
      const { workUnitId, batchId } = job.data as { workUnitId: string; batchId: string };
      currentJob = { batchId, workUnitId };

      try {
        const dbUnit = await prisma.workUnit.findUniqueOrThrow({ where: { id: workUnitId } });
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

        const userPrompt = `Task:\n${unit.task}\n\nModel Output to Grade:\n${unit.modelOutput}\n\nRubric:\n${rubricText}\n\nGrade this output carefully using the rubric.`;

        const messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; tool_use_id?: string; content?: string; id?: string; name?: string; input?: unknown }> }> = [
          { role: "user", content: userPrompt },
        ];

        let finalContent = "";
        const maxTurns = 10;

        for (let turn = 0; turn < maxTurns; turn++) {
          const isLastTurn = turn === maxTurns - 1;
          if (isLastTurn) {
            messages.push({ role: "user", content: FINAL_TURN_REMINDER });
          }

          const result = await llmCall({
            model: process.env.OLLAMA_MODEL ?? "llama3.1",
            system: REGRADE_SYSTEM,
            messages: messages as Parameters<typeof llmCall>[0]["messages"],
            tools: isLastTurn ? undefined : tools.length > 0 ? tools : undefined,
            maxTokens: 2048,
            jobId: workUnitId,
          });

          finalContent = result.content;
          await publishEvent(redis, batchId, { type: "regrade_turn", batchId, workUnitId, turn, content: result.content });

          if (!result.content.includes('"score"')) {
            messages.push({ role: "assistant", content: result.content });

            if (unit.domain === "code" && result.content.includes("execute_code")) {
              const codeMatch = result.content.match(/```(?:javascript|python)?\n([\s\S]+?)```/);
              if (!codeMatch) {
                messages.push({
                  role: "user",
                  content: "I couldn't find a fenced code block to execute. Please put the code in a ```javascript``` block, or provide your final grade as JSON.",
                });
              } else {
                const execResult = await executeCode(codeMatch[1], "javascript");
                const toolOutput = `stdout: ${execResult.stdout}\nstderr: ${execResult.stderr}\nexitCode: ${execResult.exitCode}`;
                toolOutputs.push({ tool: "execute_code", output: toolOutput });
                await publishEvent(redis, batchId, {
                  type: "regrade_tool_call",
                  batchId,
                  workUnitId,
                  turn,
                  tool: "execute_code",
                  input: { code: codeMatch[1], language: "javascript" },
                  output: toolOutput,
                });
                messages.push({ role: "user", content: `Tool result:\n${toolOutput}\n\nNow provide your final grade as JSON.` });
              }
            } else if (unit.domain === "math" && result.content.includes("verify_math")) {
              const context = `${unit.task}\n\n${rubricText}`;
              const verifyResult = await verifyMathClaim(result.content, context, workUnitId);
              const toolOutput = `correct: ${verifyResult.correct}\nexplanation: ${verifyResult.explanation}`;
              toolOutputs.push({ tool: "verify_math", output: toolOutput });
              await publishEvent(redis, batchId, {
                type: "regrade_tool_call",
                batchId,
                workUnitId,
                turn,
                tool: "verify_math",
                input: { claim: result.content, context },
                output: toolOutput,
              });
              messages.push({ role: "user", content: `Tool result:\n${toolOutput}\n\nNow provide your final grade as JSON.` });
            } else if ((unit.domain === "law" || unit.domain === "safety") && result.content.includes("retrieve_context")) {
              const query = unit.task;
              const retrieved = await retrieveContext(query, unit.attachments ?? []);
              const toolOutput = retrieved.length > 0
                ? retrieved.map((r) => `[${r.source}] ${r.text}`).join("\n\n")
                : "No relevant context found in attachments.";
              toolOutputs.push({ tool: "retrieve_context", output: toolOutput });
              await publishEvent(redis, batchId, {
                type: "regrade_tool_call",
                batchId,
                workUnitId,
                turn,
                tool: "retrieve_context",
                input: { query },
                output: toolOutput,
              });
              messages.push({ role: "user", content: `Tool result:\n${toolOutput}\n\nNow provide your final grade as JSON.` });
            } else {
              messages.push({ role: "user", content: "Please provide your final grade as JSON: {\"score\": number, \"maxScore\": number, \"reasoning\": \"...\"}." });
            }
          } else {
            break;
          }
        }

        const jsonMatch = finalContent.match(/\{[^{}]*"score"[^{}]*\}/s);
        if (!jsonMatch) {
          console.warn(`Could not parse regrade result for ${workUnitId}`);
          await publishEvent(redis, batchId, {
            type: "regrade_error",
            batchId,
            workUnitId,
            message: "Could not parse a final grade from the agent's response",
          });
          await publishEvent(redis, batchId, { type: "unit_status", batchId, workUnitId, status: "error" });
          return;
        }

        const parsed = JSON.parse(jsonMatch[0]) as { score: number; maxScore: number; reasoning: string };
        const humanPct = unit.grade.score / unit.grade.maxScore;
        const agentPct = parsed.score / parsed.maxScore;

        const agentResult: AgentRegradeResult = {
          agentScore: parsed.score,
          agentMaxScore: parsed.maxScore,
          agentReasoning: parsed.reasoning,
          toolOutputs,
          divergence: Math.abs(humanPct - agentPct),
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
        throw err;
      } finally {
        currentJob = null;
      }
    },
    { connection: redis, concurrency: 1 }
  );
}
