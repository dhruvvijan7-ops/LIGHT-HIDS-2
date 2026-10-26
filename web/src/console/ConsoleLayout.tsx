/* Console shell — efficient work surface. Stable layout, dense navigation,
   no decorative motion. Content area is a simple outlet with page header. */

import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Mark } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/hooks";
import "./console.css";

const NAV = [
  { to: "/console", label: "Overview", end: true },
  { to: "/console/uploads", label: "Uploads" },
  { to: "/console/events", label: "Events" },
  { to: "/console/findings", label: "Findings" },
  { to: "/console/rules", label: "Rules" },
  { to: "/console/runs", label: "Runs" },
  { to: "/console/jobs", label: "Jobs" },
  { to: "/console/ioc-packs", label: "IOC packs" },
  { to: "/console/audit", label: "Audit" },
  { to: "/console/workspaces", label: "Workspaces" },
  { to: "/console/system", label: "System" },
];

function PageTitleWatcher() {
  useDocumentTitle("Console · Sentinel");
  return null;
}

export function ConsoleLayout() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the mobile nav on every route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="console">
      <PageTitleWatcher />

      <a href="#main" className="c-skip">
        Skip to content
      </a>

      <header className="c-top">
        <div className="c-top-left">
          <button
            type="button"
            className="c-burger"
            aria-expanded={open}
            aria-controls="c-nav"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="sr-only">Menu</span>
            <span aria-hidden="true">☰</span>
          </button>
          <Link to="/" className="c-brand">
            <Mark size={20} />
            <span>SENTINEL</span>
            <span className="c-brand-tag">console</span>
          </Link>
        </div>
        <div className="c-top-right">
          <span
            className="c-ws mono"
            title="Workspace this session is scoped to"
          >
            {session?.workspaceId}
          </span>
          <Link to="/logout" className="btn btn-sm btn-ghost">
            Sign out
          </Link>
        </div>
      </header>

      <nav
        id="c-nav"
        className={`c-nav${open ? " is-open" : ""}`}
        aria-label="Console"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `c-nav-link${isActive ? " is-active" : ""}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main id="main" className="c-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

/** Standard page header used by every console page. */
export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="c-head">
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <h1>{title}</h1>
        {subtitle ? <p className="c-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="c-head-actions">{actions}</div> : null}
    </div>
  );
}
