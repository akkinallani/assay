import { randomUUID } from "crypto";
import type { Domain } from "@quorum/schema";

// Best-effort normalization for heterogeneous real-world exports. The philosophy: only fill in
// a default when a field is genuinely ABSENT or structurally the wrong shape (e.g. a rubric item
// that's a plain string instead of an object) — never silently override a value the source
// explicitly provided, even a wrong one (an empty task, a zero maxScore, a garbled date are real
// data problems worth surfacing as validation errors, not papering over).

const DOMAIN_VALUES: Domain[] = ["math", "code", "law", "safety", "general"];

const DOMAIN_KEYWORDS: Partial<Record<Domain, string[]>> = {
  math: ["math", "arithmetic", "calc", "algebra", "geometry", "statistic"],
  code: ["code", "engineering", "software", "program", "dev", "technical"],
  law: ["law", "legal", "compliance", "contract", "policy review"],
  safety: ["safety", "trust", "moderation", "risk", "abuse", "harm"],
};

export function normalizeDomain(raw: unknown): Domain {
  if (typeof raw === "string" && (DOMAIN_VALUES as string[]).includes(raw)) return raw as Domain;
  const lower = typeof raw === "string" ? raw.toLowerCase() : "";
  for (const domain of DOMAIN_VALUES) {
    const keywords = DOMAIN_KEYWORDS[domain];
    if (keywords?.some((kw) => lower.includes(kw))) return domain;
  }
  return "general";
}

function firstNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return undefined;
}

function firstBoolean(...candidates: unknown[]): boolean | undefined {
  for (const c of candidates) {
    if (typeof c === "boolean") return c;
  }
  return undefined;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function normalizeRubricItem(raw: unknown, index: number): Record<string, unknown> {
  // Auto-generated ids always include the item's index, since `slugify` truncates to 40 chars —
  // two criteria that merely share a long common prefix (common in templated rubric checklists)
  // would otherwise collapse onto the same id and silently corrupt coverage/coherence checks
  // that key criteria by id. An explicitly-provided id/key/criterionId is never touched.
  const autoId = (text: string) => `${slugify(text) || "criterion"}-${index + 1}`;

  // A plain string criterion — very common in simpler exports.
  if (typeof raw === "string") {
    return { id: autoId(raw), text: raw, required: true };
  }

  if (!raw || typeof raw !== "object") {
    return { id: `criterion-${index + 1}`, text: `Criterion ${index + 1}`, required: true };
  }

  const r = raw as Record<string, unknown>;
  const text =
    firstNonEmptyString(r.text, r.description, r.criterion, r.name, r.label) ?? `Criterion ${index + 1}`;
  const id = firstNonEmptyString(r.id, r.key, r.criterionId) ?? autoId(text);
  const required = firstBoolean(r.required, r.mandatory) ?? true;

  return { ...r, id, text, required };
}

export function normalizeGrade(raw: unknown): Record<string, unknown> {
  const g = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reasoning = firstNonEmptyString(g.reasoning, g.notes, g.comment, g.feedback, g.explanation, g.justification);
  return {
    ...g,
    reasoning: reasoning ?? "No reasoning provided.",
  };
}

export function normalizeWorkUnit(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const u = raw as Record<string, unknown>;

  const rubric = Array.isArray(u.rubric) ? u.rubric.map((item, i) => normalizeRubricItem(item, i)) : u.rubric;

  return {
    ...u,
    id: firstNonEmptyString(u.id) ?? randomUUID(),
    tenantId: firstNonEmptyString(u.tenantId) ?? "ignored",
    batchId: firstNonEmptyString(u.batchId) ?? "ignored",
    domain: normalizeDomain(u.domain),
    rubric,
    grade: normalizeGrade(u.grade),
    createdAt: firstNonEmptyString(u.createdAt) ?? new Date().toISOString(),
  };
}
