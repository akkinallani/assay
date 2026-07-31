import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import { ApiError } from "../api/client.js";
import { GoogleIcon } from "../components/GoogleIcon.js";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  unverified_email: "Your Google account's email isn't verified. Verify it with Google and try again.",
  google_auth_failed: "Google sign-in failed. Please try again or use your email and password.",
};

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
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
        <h1 className="text-xl font-bold text-gray-900 mb-1">Sign in to Quorum</h1>
        <p className="text-sm text-gray-500 mb-6">Welcome back.</p>

        {oauthError && (
          <p className="animate-fade-up text-sm text-red-600 mb-4">
            {OAUTH_ERROR_MESSAGES[oauthError] ?? "Something went wrong signing in with Google."}
          </p>
        )}

        <a
          href="/api/auth/google"
          className="pressable flex items-center justify-center gap-2 w-full py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150 ease-out"
        >
          <GoogleIcon />
          Continue with Google
        </a>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm transition-colors duration-150 ease-out focus:border-quorum-400"
            />
          </div>

          {error && <p className="animate-fade-up text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="pressable w-full py-2 rounded-md bg-quorum-600 text-white text-sm font-medium hover:bg-quorum-700 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-500 text-center">
          Don't have an account?{" "}
          <Link to="/signup" className="pressable inline-block text-quorum-600 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
