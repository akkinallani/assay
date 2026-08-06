import { useEffect, useState, type CSSProperties } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type WorkUnitRow, type VerdictRow, type ResolutionOutcome } from "../api/client.js";
import { RiskDial } from "../components/RiskDial.js";
import { RecommendationBadge } from "../components/RecommendationBadge.js";
import { SignalBadge } from "../components/SignalBadge.js";

type UnitWithVerdict = WorkUnitRow & { verdict: VerdictRow };

function ItemDetailSkeleton() {
  return (
    <div className="p-8">
      <div className="skeleton h-6 w-48 mb-6" />
      <div className="skeleton h-24 rounded-lg mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="skeleton h-24 rounded-md" />
          <div className="skeleton h-24 rounded-md" />
          <div className="skeleton h-24 rounded-md" />
        </div>
        <div className="skeleton h-64 rounded-md" />
      </div>
    </div>
  );
}

export function ItemDetail() {
  const { batchId, unitId } = useParams<{ batchId: string; unitId: string }>();
  const [data, setData] = useState<UnitWithVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId || !unitId) return;
    api.getUnit(batchId, unitId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [batchId, unitId]);

  async function handleResolve(outcome: ResolutionOutcome) {
    if (!data?.verdict) return;
    setResolving(true);
    setResolveError(null);
    try {
      const updated = await api.resolveVerdict(data.verdict.id, outcome, note.trim() || undefined);
      setData((prev) => (prev ? { ...prev, verdict: { ...prev.verdict, ...updated } } : prev));
      setNote("");
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setResolving(false);
    }
  }

  async function handleReopen() {
    if (!data?.verdict) return;
    setResolving(true);
    setResolveError(null);
    try {
      const updated = await api.reopenVerdict(data.verdict.id);
      setData((prev) => (prev ? { ...prev, verdict: { ...prev.verdict, ...updated } } : prev));
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setResolving(false);
    }
  }

  if (loading) return <ItemDetailSkeleton />;
  if (error) return <div className="animate-fade-up p-8 text-red-600">Error: {error}</div>;
  if (!data) return null;

  const regradeSignal = data.signals.find((s) => s.key === "regrade");
  const regradeDetail = regradeSignal?.detail as {
    agentScore: number; agentMaxScore: number; agentReasoning: string;
    toolOutputs: Array<{ tool: string; output: string }>;
    criteriaScores?: Array<{ criterionId: string; met: boolean; justification: string }>;
    coherenceIssues?: string[];
  } | undefined;

  const rubricById = new Map(data.rubric.map((c) => [c.id, c]));

  const sections = [
    { heading: "Task", content: data.task },
    { heading: "Model Output", content: data.modelOutput, pre: true },
  ];

  return (
    <div className="p-8">
      <div className="animate-fade-up flex items-center gap-4 mb-6">
        <Link to={`/app/batches/${batchId}`} className="pressable inline-block text-quorum-600 hover:underline text-sm">
          ← Queue
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Item Detail</h1>
        <span className="text-sm text-gray-500 font-mono">{unitId}</span>
      </div>

      <div className="animate-fade-up flex items-center gap-4 mb-6 p-4 rounded-lg bg-white border border-gray-200 shadow-card">
        {data.verdict && (
          <>
            <RiskDial risk={data.verdict.risk} size={64} />
            <div>
              <RecommendationBadge recommendation={data.verdict.recommendation} />
              <p className="text-sm text-gray-500 mt-1">Risk score: {(data.verdict.risk * 100).toFixed(0)}%</p>
            </div>
          </>
        )}
        <div className="ml-auto text-right">
          <p className="text-xs text-gray-500 uppercase tracking-wide">{data.domain}</p>
          <p className="text-sm text-gray-700">Grader {data.graderId}</p>
        </div>
      </div>

      {data.verdict && (
        <div className="animate-fade-up mb-6 p-4 rounded-lg border border-gray-200 bg-white shadow-card">
          {data.verdict.resolvedAt ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                    data.verdict.resolutionOutcome === "confirmed_issue"
                      ? "bg-success-50 text-success-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {data.verdict.resolutionOutcome === "confirmed_issue"
                    ? "✓ Confirmed issue"
                    : data.verdict.resolutionOutcome === "false_positive"
                      ? "✕ False positive"
                      : "✓ Resolved"}
                </span>
                <span className="text-xs text-gray-400">
                  {data.verdict.resolvedByEmail ? `by ${data.verdict.resolvedByEmail} · ` : ""}
                  {new Date(data.verdict.resolvedAt).toLocaleString()}
                </span>
              </div>
              {data.verdict.resolutionNote && <p className="text-sm text-gray-700 mb-3">{data.verdict.resolutionNote}</p>}
              <button
                onClick={handleReopen}
                disabled={resolving}
                className="pressable text-sm font-medium text-quorum-600 hover:underline disabled:opacity-50"
              >
                Reopen
              </button>
            </div>
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Resolve this item</h2>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you decide? (optional)"
                rows={2}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm transition-colors duration-150 ease-out focus:border-quorum-400 mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleResolve("confirmed_issue")}
                  disabled={resolving}
                  className="pressable px-4 py-2 rounded-md bg-danger-600 text-white text-sm font-medium hover:bg-danger-700 disabled:opacity-60"
                >
                  {resolving ? "Saving…" : "Confirmed real issue"}
                </button>
                <button
                  onClick={() => handleResolve("false_positive")}
                  disabled={resolving}
                  className="pressable px-4 py-2 rounded-md bg-gray-600 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-60"
                >
                  {resolving ? "Saving…" : "False positive"}
                </button>
              </div>
            </div>
          )}
          {resolveError && <p className="animate-fade-up text-sm text-red-600 mt-2">{resolveError}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {sections.map((s, i) => (
            <section key={s.heading} className="stagger-item" style={{ "--stagger-index": i } as CSSProperties}>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{s.heading}</h2>
              {s.pre ? (
                <pre className="text-sm text-gray-800 bg-white border border-gray-200 rounded-md p-3 whitespace-pre-wrap">
                  {s.content}
                </pre>
              ) : (
                <p className="text-sm text-gray-800 bg-white border border-gray-200 rounded-md p-3">{s.content}</p>
              )}
            </section>
          ))}

          <section className="stagger-item" style={{ "--stagger-index": 2 } as CSSProperties}>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Human Grade — {data.grade.score}/{data.grade.maxScore}
            </h2>
            <p className="text-sm text-gray-800 bg-white border border-gray-200 rounded-md p-3">
              {data.grade.reasoning}
            </p>
          </section>

          <section className="stagger-item" style={{ "--stagger-index": 3 } as CSSProperties}>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Signals</h2>
            <div className="space-y-2">
              {data.signals.map((s) => (
                <SignalBadge key={s.id} signalKey={s.key} fired={s.fired} evidence={s.evidence} />
              ))}
              {data.signals.filter((s) => !s.fired).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-gray-50 border border-gray-200 text-xs text-gray-500"
                >
                  <span className="font-medium capitalize">{s.key}:</span>
                  <span>{s.evidence}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {regradeDetail ? (
          <div className="animate-fade-up space-y-4">
            <section>
              <h2 className="text-sm font-semibold text-quorum-700 uppercase tracking-wide mb-2">
                Agent Re-Grade — {regradeDetail.agentScore}/{regradeDetail.agentMaxScore}
              </h2>
              <p className="text-sm text-gray-800 bg-quorum-50 border border-quorum-100 rounded-md p-3">
                {regradeDetail.agentReasoning}
              </p>
            </section>

            {regradeDetail.coherenceIssues && regradeDetail.coherenceIssues.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-danger-700 uppercase tracking-wide mb-2">
                  Agent Reasoning May Be Unreliable
                </h2>
                <div className="space-y-2">
                  {regradeDetail.coherenceIssues.map((issue, i) => (
                    <div key={i} className="p-2 rounded-lg bg-danger-50 border border-danger-100 text-sm text-danger-700">
                      {issue}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {regradeDetail.criteriaScores && regradeDetail.criteriaScores.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Agent's Criterion-by-Criterion Breakdown
                </h2>
                <div className="space-y-2">
                  {regradeDetail.criteriaScores.map((c) => (
                    <div
                      key={c.criterionId}
                      className={`p-2 rounded-lg border text-sm ${
                        c.met ? "bg-success-50 border-success-100" : "bg-danger-50 border-danger-100"
                      }`}
                    >
                      <p className={`font-medium ${c.met ? "text-success-700" : "text-danger-700"}`}>
                        {c.met ? "Met" : "Not met"}: {rubricById.get(c.criterionId)?.text ?? c.criterionId}
                      </p>
                      <p className={c.met ? "text-success-600" : "text-danger-600"}>{c.justification}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {regradeDetail.toolOutputs.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Tool Outputs</h2>
                {regradeDetail.toolOutputs.map((t, i) => (
                  <div key={i} className="mb-2">
                    <p className="text-xs font-mono text-gray-500 mb-1">{t.tool}</p>
                    <pre className="text-xs bg-gray-900 text-green-400 rounded-md p-2 overflow-x-auto">{t.output}</pre>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : regradeSignal ? (
          <div className="animate-fade-up flex flex-col items-center justify-center gap-1 h-32 bg-danger-50 rounded-lg border border-dashed border-danger-200 text-danger-600 text-sm text-center px-4">
            <span className="font-medium">Agent re-grade failed</span>
            <span className="text-xs text-danger-500">{regradeSignal.evidence}</span>
          </div>
        ) : (
          <div className="animate-fade-up flex items-center justify-center h-32 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-gray-400 text-sm">
            Agent re-grade pending or not triggered
          </div>
        )}
      </div>
    </div>
  );
}
