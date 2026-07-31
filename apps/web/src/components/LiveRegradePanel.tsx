import type { CSSProperties } from "react";
import type { RegradeCompleteEvent, RegradeToolCallEvent, RegradeTurnEvent } from "@quorum/schema";

export interface UnitLiveState {
  status: "queued" | "regrading" | "graded" | "error";
  turns: RegradeTurnEvent[];
  toolCalls: RegradeToolCallEvent[];
  complete?: RegradeCompleteEvent;
  error?: string;
}

const STATUS_STYLES: Record<UnitLiveState["status"], string> = {
  queued: "bg-quorum-100 text-quorum-500",
  regrading: "bg-accent-50 text-accent-600",
  graded: "bg-success-50 text-success-700",
  error: "bg-danger-50 text-danger-700",
};

export function LiveRegradePanel({ unitId, state }: { unitId: string; state: UnitLiveState }) {
  return (
    <div key={unitId} className="animate-fade-up space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-gray-500">{unitId}</span>
        <span
          className={`text-xs px-2 py-1 rounded-full transition-colors duration-200 ease-out ${STATUS_STYLES[state.status]}`}
        >
          {state.status === "regrading" ? "regrading…" : state.status}
        </span>
        {state.status === "regrading" && (
          <span className="h-1.5 w-1.5 rounded-full bg-accent-400 animate-pulse" />
        )}
      </div>

      {state.turns.length === 0 && state.status === "regrading" && (
        <p className="text-sm text-gray-400">Waiting for the first model response…</p>
      )}

      <div className="space-y-2">
        {state.turns.map((turn) => {
          const toolCall = state.toolCalls.find((t) => t.turn === turn.turn);
          return (
            <div
              key={turn.turn}
              className="stagger-item rounded-lg border border-gray-200 bg-white p-3 shadow-card"
              style={{ "--stagger-index": Math.min(turn.turn, 6) } as CSSProperties}
            >
              <p className="text-xs font-semibold text-gray-500 mb-1">Turn {turn.turn + 1}</p>
              <pre className="text-xs text-gray-800 whitespace-pre-wrap">{turn.content}</pre>
              {toolCall && (
                <details className="mt-2 text-xs" open>
                  <summary className="pressable inline-block cursor-pointer font-mono text-quorum-600 hover:text-quorum-700">
                    tool: {toolCall.tool}
                  </summary>
                  <div className="animate-fade-up mt-1 pl-3 border-l-2 border-quorum-200 space-y-1">
                    <pre className="text-gray-500 whitespace-pre-wrap">
                      input: {JSON.stringify(toolCall.input, null, 2)}
                    </pre>
                    <pre className="bg-gray-900 text-green-400 rounded-md p-2 overflow-x-auto whitespace-pre-wrap">
                      {toolCall.output}
                    </pre>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {state.complete && (
        <section className="animate-fade-up">
          <h3 className="text-sm font-semibold text-quorum-700 uppercase tracking-wide mb-2">
            Agent Re-Grade — {state.complete.agentScore}/{state.complete.agentMaxScore}
          </h3>
          <p className="text-sm text-gray-800 bg-quorum-50 border border-quorum-100 rounded-lg p-3">
            {state.complete.agentReasoning}
          </p>
        </section>
      )}

      {state.error && (
        <div className="animate-fade-up p-3 rounded-lg bg-danger-50 border border-danger-100 text-sm text-danger-700">
          {state.error}
        </div>
      )}
    </div>
  );
}
