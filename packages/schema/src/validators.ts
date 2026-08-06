import { z } from "zod";

export const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  required: z.boolean(),
  weight: z.number().min(0).max(1).optional(),
});

export const criterionScoreSchema = z.object({
  criterionId: z.string(),
  score: z.number(),
  note: z.string().optional(),
});

export const gradeSchema = z.object({
  score: z.number().min(0),
  maxScore: z.number().positive(),
  reasoning: z.string().min(1),
  criteriaScores: z.array(criterionScoreSchema).optional(),
});

export const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  mimeType: z.string().optional(),
});

export const workUnitSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  batchId: z.string().min(1),
  domain: z.enum(["math", "code", "law", "safety", "general"]),
  task: z.string().min(1),
  rubric: z
    .array(rubricCriterionSchema)
    .min(1)
    // coverageSignal (packages/engine) and checkRubricCoherence both key criteria by id
    // (Set/Map lookups) and silently collapse two criteria sharing an id onto one — scoring
    // either one makes both read as "addressed", even when a genuinely-unaddressed required
    // criterion (e.g. a safety warning) is the one that got shadowed.
    .refine((criteria) => new Set(criteria.map((c) => c.id)).size === criteria.length, {
      message: "Rubric criterion ids must be unique within a work unit",
    }),
  modelOutput: z.string().min(1),
  attachments: z.array(attachmentSchema).optional(),
  grade: gradeSchema,
  graderId: z.string().min(1),
  timeSpentSec: z.number().int().positive().max(2147483647).optional(),
  createdAt: z.string().datetime(),
});

export const batchIngestSchema = z.array(workUnitSchema).min(1).max(10000);

export const resolveVerdictSchema = z.object({
  outcome: z.enum(["confirmed_issue", "false_positive"]),
  note: z.string().max(2000).optional(),
});

export type WorkUnitInput = z.infer<typeof workUnitSchema>;
export type BatchIngestInput = z.infer<typeof batchIngestSchema>;
export type ResolveVerdictInput = z.infer<typeof resolveVerdictSchema>;
