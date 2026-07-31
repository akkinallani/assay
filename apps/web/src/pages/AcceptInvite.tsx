import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import { ApiError } from "../api/client.js";

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvite(token, password);
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="animate-fade-up w-full max-w-sm bg-white rounded-lg border border-gray-200 shadow-card p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Join your team</h1>
        <p className="text-sm text-gray-500 mb-6">Set a password to finish joining.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm transition-colors duration-150 ease-out focus:border-quorum-400"
            />
            <p className="mt-1 text-xs text-gray-400">At least 8 characters.</p>
          </div>

          {error && <p className="animate-fade-up text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="pressable w-full py-2 rounded-md bg-quorum-600 text-white text-sm font-medium hover:bg-quorum-700 disabled:opacity-60"
          >
            {submitting ? "Joining…" : "Join team"}
          </button>
        </form>
      </div>
    </div>
  );
}
