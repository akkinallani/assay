import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import { ApiError } from "../api/client.js";

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signup(email, password, tenantName);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="animate-fade-up w-full max-w-sm bg-white rounded-lg border border-gray-200 shadow-card p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Create your account</h1>
        <p className="text-sm text-gray-500 mb-6">Sets up a new organization on Quorum.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="tenantName">
              Organization name
            </label>
            <input
              id="tenantName"
              type="text"
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm transition-colors duration-150 ease-out focus:border-quorum-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm transition-colors duration-150 ease-out focus:border-quorum-400"
            />
          </div>
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
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-500 text-center">
          Already have an account?{" "}
          <Link to="/login" className="pressable inline-block text-quorum-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
