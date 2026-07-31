import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type PendingInvite, type TeamMember } from "../api/client.js";

function inviteLink(token: string) {
  return `${window.location.origin}/invite/${token}`;
}

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(inviteLink(token));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="pressable text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors duration-150 ease-out"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}

export function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    return Promise.all([api.listTeamMembers(), api.listInvites()]).then(([m, i]) => {
      setMembers(m);
      setInvites(i);
    });
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      await api.inviteTeammate(email);
      setEmail("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="skeleton h-8 w-40 mb-6" />
        <div className="skeleton h-32 rounded-lg mb-6" />
        <div className="skeleton h-32 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="animate-fade-up text-2xl font-bold text-gray-900 mb-6">Team</h1>

      <section className="animate-fade-up mb-8">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Members</h2>
        <div className="rounded-lg border border-gray-200 bg-white shadow-card divide-y divide-gray-100">
          {members.map((m) => (
            <div key={m.id} className="p-3 flex items-center justify-between text-sm">
              <span className="text-gray-800">{m.email}</span>
              <span className="text-xs text-gray-400">
                Joined {new Date(m.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="animate-fade-up">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Invite a teammate</h2>
        <form onSubmit={handleInvite} className="flex gap-2 mb-4">
          <input
            type="email"
            required
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 px-3 py-2 rounded-md border border-gray-300 text-sm transition-colors duration-150 ease-out focus:border-quorum-400"
          />
          <button
            type="submit"
            disabled={inviting}
            className="pressable px-4 py-2 rounded-md bg-quorum-600 text-white text-sm font-medium hover:bg-quorum-700 disabled:opacity-60"
          >
            {inviting ? "Sending…" : "Invite"}
          </button>
        </form>

        {error && <p className="animate-fade-up text-sm text-red-600 mb-4">{error}</p>}

        {invites.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white shadow-card divide-y divide-gray-100">
            {invites.map((i) => (
              <div key={i.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-800 truncate">{i.email}</p>
                  <p className="text-xs text-gray-400">
                    {i.expired ? "Expired" : `Expires ${new Date(i.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                {!i.expired && <CopyLinkButton token={i.token} />}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
