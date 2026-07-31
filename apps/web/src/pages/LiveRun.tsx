import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams, Link } from "react-router-dom";
import type { BatchProgressEvent, QuorumLiveEvent } from "@quorum/schema";
import { LiveRegradePanel, type UnitLiveState } from "../components/LiveRegradePanel.js";

function applyEvent(
  units: Map<string, UnitLiveState>,
  event: QuorumLiveEvent
): Map<string, UnitLiveState> {
  if (event.type === "batch_progress") return units;

  const next = new Map(units);
  const existing = next.get(event.workUnitId) ?? { status: "queued" as const, turns: [], toolCalls: [] };

  switch (event.type) {
    case "unit_status":
      if (event.status === "regrading") {
        next.set(event.workUnitId, { status: "regrading", turns: [], toolCalls: [] });
      } else {
        next.set(event.workUnitId, { ...existing, status: event.status });
      }
      break;
    case "regrade_turn":
      next.set(event.workUnitId, { ...existing, turns: [...existing.turns, event] });
      break;
    case "regrade_tool_call":
      next.set(event.workUnitId, { ...existing, toolCalls: [...existing.toolCalls, event] });
      break;
    case "regrade_complete":
      next.set(event.workUnitId, { ...existing, complete: event });
      break;
    case "regrade_error":
      next.set(event.workUnitId, { ...existing, error: event.message });
      break;
  }
  return next;
}

export function LiveRun() {
  const { batchId } = useParams<{ batchId: string }>();
  const [progress, setProgress] = useState<BatchProgressEvent | null>(null);
  const [units, setUnits] = useState<Map<string, UnitLiveState>>(new Map());
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!batchId) return;

    const source = new EventSource(`/api/batches/${batchId}/live`);
    sourceRef.current = source;

    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as QuorumLiveEvent;
      if (event.type === "batch_progress") {
        setProgress(event);
      } else {
        if (event.type === "unit_status" && event.status === "regrading") {
          setActiveUnitId(event.workUnitId);
        }
        setUnits((prev) => applyEvent(prev, event));
      }
    };
    source.onerror = () => setConnectionError(true);

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [batchId]);

  const displayedUnitId = selectedUnitId ?? activeUnitId;
  const displayedState = displayedUnitId ? units.get(displayedUnitId) : undefined;
  const unitIds = Array.from(units.keys());

  const isFullyDone =
    progress?.batchStatus === "done" &&
    progress.regradeQueued === 0 &&
    progress.regradeProcessing === 0;

  return (
    <div className="p-8">
      <div className="animate-fade-up flex items-center gap-4 mb-6">
        <Link to="/app" className="pressable inline-block text-quorum-600 hover:underline text-sm">
          ← Batches
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Live Run</h1>
        <span className="text-sm text-gray-500 font-mono">{batchId}</span>
      </div>

      {connectionError && (
        <p className="animate-fade-up mb-4 text-sm text-red-600">
          Lost connection to the live stream. Refresh to reconnect.
        </p>
      )}

      {!progress ? (
        <p className="text-gray-500 text-sm flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 border-t-gray-500 animate-spin" />
          Connecting…
        </p>
      ) : (
        <>
          <div className="animate-fade-up grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="p-3 rounded-lg border border-gray-200 bg-white shadow-card">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Scored</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums transition-all duration-200 ease-out">
                {progress.scoredUnits}/{progress.totalUnits}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-gray-200 bg-white shadow-card">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Flagged</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums transition-all duration-200 ease-out">
                {progress.flaggedForRegrade}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-gray-200 bg-white shadow-card">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Regrading</p>
              <p className="text-lg font-semibold text-accent-600 tabular-nums transition-all duration-200 ease-out">
                {progress.regradeProcessing}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-gray-200 bg-white shadow-card">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Regrade Done</p>
              <p className="text-lg font-semibold text-success-600 tabular-nums transition-all duration-200 ease-out">
                {progress.regradeDone}/{progress.flaggedForRegrade}
              </p>
            </div>
          </div>

          {isFullyDone && (
            <div className="animate-scale-in mb-6 p-4 rounded-lg bg-success-50 border border-success-100 flex items-center justify-between">
              <span className="text-sm text-success-700">Run complete.</span>
              <Link
                to={`/app/batches/${batchId}`}
                className="pressable inline-block text-sm font-medium text-quorum-600 hover:underline"
              >
                View full verdict queue →
              </Link>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Regrading Items
          </h2>
          {unitIds.length === 0 ? (
            <p className="text-sm text-gray-400">
              {progress?.flaggedForRegrade ? "Waiting for the regrade queue…" : "No items flagged for regrade yet."}
            </p>
          ) : (
            unitIds.map((id, i) => {
              const state = units.get(id)!;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedUnitId(id)}
                  className={`pressable stagger-item w-full text-left p-3 rounded-lg border text-sm transition-colors duration-150 ease-out ${
                    displayedUnitId === id ? "border-quorum-400 bg-quorum-50" : "border-gray-200 hover:bg-gray-50"
                  }`}
                  style={{ "--stagger-index": i } as CSSProperties}
                >
                  <span className="font-mono text-xs text-gray-600">{id}</span>
                  <span className="ml-2 text-xs text-gray-400">{state.status}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="lg:col-span-2">
          {displayedUnitId && displayedState ? (
            <LiveRegradePanel unitId={displayedUnitId} state={displayedState} />
          ) : (
            <div className="flex items-center justify-center h-32 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-gray-400 text-sm">
              Select an item to see its live regrade
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
