export type Domain = "math" | "code" | "law" | "safety" | "general";
export type SignalKey = "consistency" | "coverage" | "cohort" | "regrade";
export type Recommendation = "clear" | "spot_check" | "re_review";

export interface RubricCriterion {
  id: string;
  text: string;
  required: boolean;
  weight?: number;
}

export interface CriterionScore {
  criterionId: string;
  score: number;
  note?: string;
}

export interface Grade {
  score: number;
  maxScore: number;
  reasoning: string;
  criteriaScores?: CriterionScore[];
}

export interface Attachment {
  id: string;
  name: string;
  content: string;
  mimeType?: string;
}

export interface WorkUnit {
  id: string;
  tenantId: string;
  batchId: string;
  domain: Domain;
  task: string;
  rubric: RubricCriterion[];
  modelOutput: string;
  attachments?: Attachment[];
  grade: Grade;
  graderId: string;
  timeSpentSec?: number;
  createdAt: string;
}

export interface Signal {
  key: SignalKey;
  fired: boolean;
  weight: number;
  evidence: string;
  detail?: unknown;
}

export interface Verdict {
  workUnitId: string;
  risk: number;
  recommendation: Recommendation;
  signals: Signal[];
}

export interface GraderDomainStat {
  itemsSeen: number;
  flagCount: number;
}

export interface GraderScorecard {
  graderId: string;
  itemsSeen: number;
  flagRate: number;
  agreementWithRegrade: number;
  domainBreakdown: Record<string, GraderDomainStat>;
}

export interface AgentRegradeResult {
  agentScore: number;
  agentMaxScore: number;
  agentReasoning: string;
  toolOutputs: Array<{ tool: string; output: string }>;
  divergence: number;
}

export interface VerdictWithUnit extends Verdict {
  workUnit: WorkUnit;
}
