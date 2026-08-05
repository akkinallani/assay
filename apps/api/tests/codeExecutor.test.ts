import { describe, expect, it } from "vitest";
import { extractCodeBlock, executeCode } from "../src/llm/tools/codeExecutor.js";

describe("extractCodeBlock", () => {
  it("detects a python fence and keeps it as python", () => {
    const content = "Let me check this:\n```python\nprint(2 + 2)\n```\n";
    expect(extractCodeBlock(content)).toEqual({ code: "print(2 + 2)\n", language: "python" });
  });

  it("detects a javascript fence and keeps it as javascript", () => {
    const content = "```javascript\nconsole.log(2 + 2)\n```";
    expect(extractCodeBlock(content)).toEqual({ code: "console.log(2 + 2)\n", language: "javascript" });
  });

  it("defaults to javascript for an unlabeled fence", () => {
    const content = "```\nconsole.log(1)\n```";
    expect(extractCodeBlock(content)).toEqual({ code: "console.log(1)\n", language: "javascript" });
  });

  it("returns null when there is no fenced code block", () => {
    expect(extractCodeBlock("just some prose, no code here")).toBeNull();
  });
});

describe("executeCode", () => {
  it("actually runs python code as python, not javascript", async () => {
    const result = await executeCode("print(2 + 2)", "python");
    expect(result.stdout).toBe("4");
    expect(result.exitCode).toBe(0);
  });

  it("actually runs javascript code as javascript", async () => {
    const result = await executeCode("console.log(2 + 2)", "javascript");
    expect(result.stdout).toBe("4");
    expect(result.exitCode).toBe(0);
  });
});
