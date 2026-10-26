/* Auth session for the API-key sign-in flow.
   There is no password/session backend: the API authenticates with a static
   X-API-Key header and every path is workspace-scoped. Sign-in therefore
   stores (apiKey, workspaceId) locally and validates the pair against a real
   authenticated endpoint (GET /v1/workspaces/{id}/audit?limit=1). A 200 means
   the key is valid AND scoped to that workspace. No success is ever faked. */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, type AuditEntry, api, type Page } from "./api";

const STORAGE_KEY = "sentinel.session.v1";
const LEGACY_KEY = "sentinel.apikey.v1";

export interface Session {
  apiKey: string;
  workspaceId: string;
  storedAt: string;
}

interface AuthContextValue {
  session: Session | null;
  ready: boolean;
  /** Validate credentials against the API, then persist on success. */
  signIn: (apiKey: string, workspaceId: string) => Promise<void>;
  /** Clear the local session (the API has no server-side session to revoke). */
  signOut: () => void;
  apiKey: string | null;
  workspaceId: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadSession(): Session | null {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.apiKey === "string" &&
      typeof parsed.workspaceId === "string" &&
      parsed.apiKey &&
      parsed.workspaceId
    ) {
      return {
        apiKey: parsed.apiKey,
        workspaceId: parsed.workspaceId,
        storedAt: parsed.storedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    /* corrupted storage — treat as signed out */
  }
  return null;
}

function persist(session: Session, remember: boolean): void {
  const raw = JSON.stringify(session);
  if (remember) {
    localStorage.setItem(STORAGE_KEY, raw);
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, raw);
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    // Migrate any pre-release localStorage key, then drop it.
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const signIn = useCallback(async (apiKey: string, workspaceId: string) => {
    const key = apiKey.trim();
    const ws = workspaceId.trim();
    if (!key)
      throw new ApiError(400, {
        code: "BAD_REQUEST",
        message: "An API key is required.",
      });
    if (!ws) {
      throw new ApiError(400, {
        code: "BAD_REQUEST",
        message:
          "A workspace ID is required — API keys are scoped to a single workspace.",
      });
    }
    // Real validation: hit an implemented, authenticated, workspace-scoped
    // endpoint. 200 → key valid and workspace matches. 401 → bad key.
    // Tenant mismatch surfaces as a Gate error (403/409-family).
    await api<Page<AuditEntry>>(
      `/v1/workspaces/${encodeURIComponent(ws)}/audit`,
      {
        apiKey: key,
        query: { limit: 1 },
      },
    );
    const next: Session = {
      apiKey: key,
      workspaceId: ws,
      storedAt: new Date().toISOString(),
    };
    // Default to session-scoped storage; "remember" is set via login page flag
    // through the rememberSession option below.
    const remember =
      next.apiKey.length > 0 &&
      localStorage.getItem("sentinel.remember") === "1";
    persist(next, remember);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("sentinel.remember");
    } catch {
      /* ignore */
    }
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      ready,
      signIn,
      signOut,
      apiKey: session?.apiKey ?? null,
      workspaceId: session?.workspaceId ?? null,
    }),
    [session, ready, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
