import { z } from "zod";

// Shapes for LLM-produced output specifically — distinct from @quorum/schema's
// ingestion-facing schemas. These validate what a model actually returns, not
// what a client submits.

export const criterionScoreOutputSchema = z.object({
  criterionId: z.string().min(1),
  met: z.boolean(),
  justification: z.string().min(1),
});

export const regradeGradeSchema = z.object({
  score: z.number().min(0),
  maxScore: z.number().positive(),
  reasoning: z.string().min(1),
  criteriaScores: z.array(criterionScoreOutputSchema).min(1),
});

export const mathVerifySchema = z.object({
  correct: z.boolean(),
  explanation: z.string().min(1),
});

export const consistencyCheckSchema = z.object({
  consistent: z.boolean(),
  evidence: z.string().min(1),
});

export const factCheckSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string().min(1),
      verdict: z.enum(["supported", "unsupported", "contradicted"]),
      evidence: z.string().min(1),
    })
  ),
});

export type RegradeGradeOutput = z.infer<typeof regradeGradeSchema>;
export type MathVerifyOutput = z.infer<typeof mathVerifySchema>;
export type ConsistencyCheckOutput = z.infer<typeof consistencyCheckSchema>;
export type FactCheckOutput = z.infer<typeof factCheckSchema>;
