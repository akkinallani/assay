import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api, type BatchSummary } from "../api/client.js";

function BatchListSkeleton() {
  return (
    <div className="p-8">
      <div className="skeleton h-8 w-40 mb-6" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-20 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function BatchList() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getBatches()
      .then(setBatches)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <BatchListSkeleton />;
  if (error) return <div className="animate-fade-up p-8 text-red-600">Error: {error}</div>;

  return (
    <div className="p-8">
      <h1 className="animate-fade-up text-2xl font-bold text-gray-900 mb-6">Batches</h1>
      {batches.length === 0 ? (
        <p className="animate-fade-up text-gray-500">
          No batches yet.{" "}
          <Link to="/app/upload" className="pressable inline-block text-quorum-600 hover:underline">
            Upload your data
          </Link>{" "}
          to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {batches.map((b, i) => (
            <Link
              key={b.id}
              to={b.status === "done" ? `/app/batches/${b.id}` : `/app/batches/${b.id}/live`}
              className="pressable card-interactive stagger-item block p-4 rounded-lg border border-gray-200 bg-white hover:border-quorum-300"
              style={{ "--stagger-index": i } as CSSProperties}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm text-gray-700">{b.id}</span>
                  <span className="ml-3 text-sm text-gray-500">{b.unitCount} items</span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full transition-colors duration-150 ease-out ${
                      b.status === "done"
                        ? "bg-success-50 text-success-700"
                        : b.status === "processing"
                          ? "bg-accent-50 text-accent-600"
                          : "bg-quorum-100 text-quorum-500"
                    }`}
                  >
                    {b.status}
                  </span>
                  <span className="text-xs text-gray-400">{new Date(b.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
