export interface BatchProgressEvent {
  type: "batch_progress";
  batchId: string;
  totalUnits: number;
  scoredUnits: number;
  flaggedForRegrade: number;
  regradeQueued: number;
  regradeProcessing: number;
  regradeDone: number;
  batchStatus: "pending" | "done";
}

export interface UnitStatusEvent {
  type: "unit_status";
  batchId: string;
  workUnitId: string;
  status: "regrading" | "graded" | "error";
}

export interface RegradeTurnEvent {
  type: "regrade_turn";
  batchId: string;
  workUnitId: string;
  turn: number;
  content: string;
}

export interface RegradeToolCallEvent {
  type: "regrade_tool_call";
  batchId: string;
  workUnitId: string;
  turn: number;
  tool: "execute_code" | "verify_math" | "retrieve_context" | "fact_check";
  input: unknown;
  output: string;
}

export interface RegradeCompleteEvent {
  type: "regrade_complete";
  batchId: string;
  workUnitId: string;
  agentScore: number;
  agentMaxScore: number;
  agentReasoning: string;
  divergence: number;
}

export interface RegradeErrorEvent {
  type: "regrade_error";
  batchId: string;
  workUnitId: string;
  message: string;
}

export type QuorumLiveEvent =
  | BatchProgressEvent
  | UnitStatusEvent
  | RegradeTurnEvent
  | RegradeToolCallEvent
  | RegradeCompleteEvent
  | RegradeErrorEvent;
