import type { GraderScorecard } from "@quorum/schema";

const BASE = "/api";
// X-Requested-With is a CSRF defense-in-depth signal the API requires on every
// mutating request — a cross-site form/fetch can't set custom headers.
const HEADERS = { "Content-Type": "application/json", "X-Requested-With": "quorum" };

export interface CurrentUser {
  id: string;
  email: string;
  tenantId: string;
  tenantName: string;
}

export interface BatchSummary {
  id: string;
  tenantId: string;
  status: string;
  createdAt: string;
  unitCount: number;
}

export interface SignalRow {
  id: string;
  workUnitId: string;
  key: string;
  fired: boolean;
  weight: number;
  evidence: string;
  detail: unknown;
}

export interface RubricCriterionRow {
  id: string;
  text: string;
  required: boolean;
  weight?: number;
}

export interface WorkUnitRow {
  id: string;
  domain: string;
  task: string;
  rubric: RubricCriterionRow[];
  modelOutput: string;
  grade: { score: number; maxScore: number; reasoning: string };
  graderId: string;
  signals: SignalRow[];
}

export type ResolutionOutcome = "confirmed_issue" | "false_positive";

export interface VerdictResolution {
  id: string;
  workUnitId: string;
  risk: number;
  recommendation: string;
  resolvedAt: string | null;
  resolvedByEmail: string | null;
  resolutionNote: string | null;
  resolutionOutcome: ResolutionOutcome | null;
}

export interface VerdictRow extends VerdictResolution {
  workUnit: WorkUnitRow;
}

export interface SignalAccuracy {
  key: string;
  firedCount: number;
  confirmedCount: number;
  falsePositiveCount: number;
  precision: number | null;
}

export interface AccuracyReport {
  overall: {
    resolvedCount: number;
    confirmedCount: number;
    falsePositiveCount: number;
    precision: number | null;
  };
  bySignal: SignalAccuracy[];
}

export class ApiError extends Error {
  code?: string;
  issues?: unknown;

  constructor(message: string, code?: string, issues?: unknown) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

// Lets AuthContext know a request came back 401'd (session expired/invalidated
// server-side) so it can clear the stale `user` state and let RequireAuth redirect
// to /login — every page's own error handling only shows the failure inline, with
// no path back to a working screen otherwise.
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

async function throwForError(res: Response): Promise<never> {
  const payload = await res.json().catch(() => ({}) as Record<string, unknown>);
  const message = (payload.message as string) ?? `${res.status} ${JSON.stringify(payload)}`;
  if (res.status === 401) unauthorizedHandler?.();
  throw new ApiError(message, payload.error as string | undefined, payload.issues);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS, credentials: "include" });
  if (!res.ok) return throwForError(res);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: HEADERS,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) return throwForError(res);
  return res.json() as Promise<T>;
}

export interface CreateBatchResult {
  batchId: string;
  unitCount: number;
}

export interface TeamMember {
  id: string;
  email: string;
  createdAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  token: string;
  expiresAt: string;
  expired: boolean;
}

export const api = {
  getBatches: () => get<BatchSummary[]>("/batches"),
  getVerdicts: (batchId: string) => get<VerdictRow[]>(`/batches/${batchId}/verdict`),
  getUnit: (batchId: string, unitId: string) =>
    get<WorkUnitRow & { verdict: VerdictRow }>(`/batches/${batchId}/units/${unitId}`),
  getGraders: () => get<GraderScorecard[]>("/graders"),
  createBatch: (units: unknown[]) => post<CreateBatchResult>("/batches", units),
  signup: (input: { email: string; password: string; tenantName: string }) =>
    post<CurrentUser>("/auth/signup", input),
  login: (input: { email: string; password: string }) => post<CurrentUser>("/auth/login", input),
  logout: () => post<{ ok: boolean }>("/auth/logout", {}),
  me: () => get<CurrentUser>("/auth/me"),
  listTeamMembers: () => get<TeamMember[]>("/team/members"),
  listInvites: () => get<PendingInvite[]>("/invites"),
  inviteTeammate: (email: string) => post<PendingInvite>("/invites", { email }),
  acceptInvite: (token: string, password: string) =>
    post<CurrentUser>(`/invites/${token}/accept`, { password }),
  resolveVerdict: (verdictId: string, outcome: ResolutionOutcome, note?: string) =>
    post<VerdictResolution>(`/verdicts/${verdictId}/resolve`, { outcome, note }),
  reopenVerdict: (verdictId: string) => post<VerdictResolution>(`/verdicts/${verdictId}/reopen`, {}),
  getAccuracy: () => get<AccuracyReport>("/accuracy"),
};
