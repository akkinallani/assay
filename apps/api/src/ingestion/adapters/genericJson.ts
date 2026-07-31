import { workUnitSchema, type WorkUnit } from "@quorum/schema";
import { ZodError } from "zod";

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string; message: string }>
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function genericJsonAdapter(raw: unknown): WorkUnit[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("Batch must be an array", [
      { path: "root", message: "Expected array of work units" },
    ]);
  }

  const units: WorkUnit[] = [];
  const issues: Array<{ path: string; message: string }> = [];

  for (let i = 0; i < raw.length; i++) {
    try {
      units.push(workUnitSchema.parse(raw[i]) as WorkUnit);
    } catch (err) {
      if (err instanceof ZodError) {
        for (const issue of err.issues) {
          issues.push({
            path: `[${i}].${issue.path.join(".")}`,
            message: issue.message,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(`${issues.length} validation error(s)`, issues);
  }

  return units;
}
