import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client.js";

type RawUnit = Record<string, unknown>;

export function UploadBatch() {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [pendingUnits, setPendingUnits] = useState<RawUnit[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function submit(units: RawUnit[]) {
    setSubmitting(true);
    setError(null);
    setDuplicateError(null);
    try {
      const { batchId } = await api.createBatch(units);
      navigate(`/app/batches/${batchId}/live`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "duplicate_work_unit_id") {
        setDuplicateError(e.message);
        setPendingUnits(units);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setIssues(null);
    setError(null);
    setDuplicateError(null);
    setPendingUnits(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setIssues(["File is not valid JSON."]);
      return;
    }

    // Only a light structural check here — the server does the real validation and is tolerant
    // of common shape variations (free-form domain labels, rubric items as plain strings, missing
    // reasoning/timestamps get sensible defaults). No point rejecting client-side something the
    // server would happily accept.
    if (!Array.isArray(parsed) || parsed.length === 0) {
      setIssues(["File must be a JSON array with at least one work unit."]);
      return;
    }
    if (!parsed.every((u) => u && typeof u === "object")) {
      setIssues(["Every item in the array must be an object."]);
      return;
    }

    await submit(parsed as RawUnit[]);
  }

  function retryWithUniqueIds() {
    if (!pendingUnits) return;
    const suffix = Date.now().toString(36);
    void submit(pendingUnits.map((u) => ({ ...u, id: `${String(u.id)}-${suffix}` })));
  }

  const codeClass = "text-xs bg-gray-100 px-1 py-0.5 rounded";

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="animate-fade-up text-2xl font-bold text-gray-900 mb-2">Upload Your Data</h1>
      <p className="animate-fade-up text-sm text-gray-500 mb-6">
        Upload a JSON array of work units to grade. Each item needs a{" "}
        <code className={codeClass}>task</code>, <code className={codeClass}>rubric</code>,{" "}
        <code className={codeClass}>modelOutput</code>, <code className={codeClass}>grade</code> and{" "}
        <code className={codeClass}>graderId</code> — everything else is flexible. Rubric criteria can be
        plain strings or objects with a few different field name conventions,{" "}
        <code className={codeClass}>domain</code> can be any label (we'll bucket it), and missing{" "}
        <code className={codeClass}>reasoning</code>/<code className={codeClass}>createdAt</code>/
        <code className={codeClass}>id</code> get sensible defaults. Work unit{" "}
        <code className={codeClass}>id</code>s must be unique across every upload you've ever made.
      </p>

      <label
        className={`animate-fade-up block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-200 ease-out ${
          isDragging
            ? "border-quorum-400 bg-quorum-50 scale-[1.01]"
            : "border-gray-300 hover:border-quorum-400 hover:bg-quorum-50"
        } ${submitting ? "opacity-60 pointer-events-none" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
      >
        <input
          type="file"
          accept="application/json"
          className="hidden"
          disabled={submitting}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <p className="text-sm text-gray-600 transition-transform duration-200 ease-out">
          {fileName ? `Selected: ${fileName}` : "Click to choose a .json file, or drag one here"}
        </p>
      </label>

      {submitting && (
        <p className="animate-fade-up mt-4 flex items-center gap-2 text-sm text-quorum-600">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-quorum-300 border-t-quorum-600 animate-spin" />
          Uploading and starting the run…
        </p>
      )}

      {issues && (
        <div className="animate-fade-up mt-4 p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700 mb-2">Validation failed</p>
          <ul className="text-xs text-red-600 space-y-1 list-disc list-inside">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {duplicateError && (
        <div className="animate-fade-up mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <p className="text-sm text-amber-800 mb-3">{duplicateError}</p>
          <button
            onClick={retryWithUniqueIds}
            disabled={submitting}
            className="pressable text-sm font-medium text-quorum-600 hover:underline disabled:opacity-50"
          >
            Retry with unique ids →
          </button>
        </div>
      )}

      {error && (
        <div className="animate-fade-up mt-4 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
