export class ApiError extends Error {
  statusCode: number;
  code: string;
  issues?: unknown;

  constructor(statusCode: number, code: string, message?: string, issues?: unknown) {
    super(message ?? code);
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

export const notFound = (code: string, message?: string) => new ApiError(404, code, message);
export const unauthorized = (message = "Unauthorized") => new ApiError(401, "unauthorized", message);
export const badRequest = (code: string, message?: string, issues?: unknown) =>
  new ApiError(400, code, message, issues);
export const conflict = (code: string, message?: string) => new ApiError(409, code, message);
