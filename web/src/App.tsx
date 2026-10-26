import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuditPage } from "./console/AuditPage";
import { ConsoleLayout } from "./console/ConsoleLayout";
import { EventsPage } from "./console/EventsPage";
import { EvidencePage } from "./console/EvidencePage";
import { FindingDetailPage } from "./console/FindingDetailPage";
import { FindingsPage } from "./console/FindingsPage";
import { IocPacksPage } from "./console/IocPacksPage";
import { JobsPage } from "./console/JobsPage";
import { OverviewPage } from "./console/OverviewPage";
import { RulesPage } from "./console/RulesPage";
import { RunDetailPage } from "./console/RunDetailPage";
import { RunsPage } from "./console/RunsPage";
import { SystemPage } from "./console/SystemPage";
import { UploadDetailPage } from "./console/UploadDetailPage";
import { UploadsPage } from "./console/UploadsPage";
import { WorkspacesPage } from "./console/WorkspacesPage";
import { useAuth } from "./lib/auth";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Logout } from "./pages/Logout";
import { NotFound } from "./pages/NotFound";

/** Send signed-out visitors to /login, preserving the intended destination. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <>{children}</>;
}

/** After sign-in, never strand the user on /login. */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  if (!ready) return null;
  if (session) return <Navigate to="/console" replace />;
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll must reset on every route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <Login />
            </RedirectIfAuthed>
          }
        />
        <Route path="/logout" element={<Logout />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route
          path="/console"
          element={
            <RequireAuth>
              <ConsoleLayout />
            </RequireAuth>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="uploads" element={<UploadsPage />} />
          <Route path="uploads/:artifactId" element={<UploadDetailPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="findings" element={<FindingsPage />} />
          <Route path="findings/:findingUid" element={<FindingDetailPage />} />
          <Route
            path="findings/:findingUid/evidence"
            element={<EvidencePage />}
          />
          <Route path="rules" element={<RulesPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="ioc-packs" element={<IocPacksPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
