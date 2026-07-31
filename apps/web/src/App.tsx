import { Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { BatchList } from "./pages/BatchList.js";
import { VerdictQueue } from "./pages/VerdictQueue.js";
import { ItemDetail } from "./pages/ItemDetail.js";
import { Scorecard } from "./pages/Scorecard.js";
import { UploadBatch } from "./pages/UploadBatch.js";
import { LiveRun } from "./pages/LiveRun.js";
import { Login } from "./pages/Login.js";
import { Signup } from "./pages/Signup.js";
import { Landing } from "./pages/Landing.js";
import { Team } from "./pages/Team.js";
import { AcceptInvite } from "./pages/AcceptInvite.js";
import { AuthProvider, useAuth } from "./context/AuthContext.js";

const navLinkClass = (isActive: boolean) =>
  `pressable text-sm px-3 py-1.5 rounded-full transition-colors duration-150 ease-out ${
    isActive
      ? "bg-quorum-50 text-quorum-700 font-medium"
      : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
  }`;

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function AppShell() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const isBatchesActive = location.pathname === "/app" || location.pathname.startsWith("/app/batches");

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white/80 backdrop-blur-sm border-b border-gray-200 px-8 py-3 flex items-center gap-2 sticky top-0 z-10">
        <span className="font-bold text-quorum-700 text-lg mr-4">Quorum</span>
        <NavLink to="/app" end className={navLinkClass(isBatchesActive)}>
          Batches
        </NavLink>
        <NavLink to="/app/upload" className={({ isActive }) => navLinkClass(isActive)}>
          Upload
        </NavLink>
        <NavLink to="/app/scorecards" className={({ isActive }) => navLinkClass(isActive)}>
          Scorecards
        </NavLink>
        <NavLink to="/app/team" className={({ isActive }) => navLinkClass(isActive)}>
          Team
        </NavLink>
        {user && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-400">{user.tenantName}</span>
            <span className="text-sm text-gray-600">{user.email}</span>
            <button
              onClick={() => void logout()}
              className="pressable text-sm px-3 py-1.5 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-150 ease-out"
            >
              Log out
            </button>
          </div>
        )}
      </nav>
      <main>
        <Routes>
          <Route path="" element={<BatchList />} />
          <Route path="upload" element={<UploadBatch />} />
          <Route path="batches/:batchId" element={<VerdictQueue />} />
          <Route path="batches/:batchId/live" element={<LiveRun />} />
          <Route path="batches/:batchId/units/:unitId" element={<ItemDetail />} />
          <Route path="scorecards" element={<Scorecard />} />
          <Route path="team" element={<Team />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route
          path="/app/*"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
