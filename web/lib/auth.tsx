"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authConfig, authLogin, type AuthUser, type Role } from "@/lib/retriever";

const TOKEN_KEY = "ccragos_token";
const RETRIEVER = process.env.NEXT_PUBLIC_RETRIEVER_URL ?? "http://localhost:8100";
const INGESTION = process.env.NEXT_PUBLIC_INGESTION_URL ?? "http://localhost:8101";

interface AuthState {
  enabled: boolean;
  ready: boolean;               // config + token check resolved
  user: AuthUser | null;
  token: string | null;
  login: (u: string, p: string) => Promise<void>;
  logout: () => void;
  can: (min: Role) => boolean;  // role gate for UI
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
const AuthCtx = createContext<AuthState | null>(null);

// Set by the provider: called once when a backend call returns 401 (expired/invalid token).
let onUnauthorized: (() => void) | null = null;
let handlingUnauthorized = false;

// Attach the bearer token to every call hitting our own backends, and catch 401s globally.
function patchFetch(token: string | null) {
  const w = window as unknown as { __origFetch?: typeof fetch };
  if (!w.__origFetch) w.__origFetch = window.fetch.bind(window);
  const orig = w.__origFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Only attach the token to OUR backends — match on origin boundary, not a loose
    // prefix, and only same-origin relative /api/* paths (never absolute third-party URLs).
    const hitsBackend = (base: string) => url === base || url.startsWith(base + "/");
    const ours = hitsBackend(RETRIEVER) || hitsBackend(INGESTION) || url.startsWith("/api/");
    if (token && ours) {
      init = { ...init, headers: { ...(init?.headers as Record<string, string>), Authorization: `Bearer ${token}` } };
    }
    const res = await orig(input, init);
    // Expired/invalid session on a real request → force re-login. Skip /auth/* (login itself
    // legitimately 401s on a bad password; boot's /auth/me is handled separately).
    if (res.status === 401 && ours && token && !url.includes("/auth/") && !handlingUnauthorized) {
      handlingUnauthorized = true;
      onUnauthorized?.();
    }
    return res;
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Boot: learn if auth is enforced + rehydrate token/user from a stored JWT.
  useEffect(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    patchFetch(stored);
    setToken(stored);
    (async () => {
      const cfg = await authConfig();
      setEnabled(cfg.enabled);
      if (cfg.enabled && stored) {
        try {
          const me = await (await fetch(`${RETRIEVER}/auth/me`)).json();
          setUser(me.user);
        } catch { localStorage.removeItem(TOKEN_KEY); setToken(null); patchFetch(null); }
      }
      setReady(true);
    })();
  }, []);

  // Guard: when enforced and unauthenticated, bounce to /login.
  useEffect(() => {
    if (ready && enabled && !token && pathname !== "/login") router.replace("/login");
  }, [ready, enabled, token, pathname, router]);

  // Register the global 401 handler: expired/invalid token mid-session → sign out + re-login.
  useEffect(() => {
    onUnauthorized = () => {
      localStorage.removeItem(TOKEN_KEY);
      patchFetch(null);
      setToken(null);
      setUser(null);
      router.replace("/login?expired=1");
    };
    return () => { onUnauthorized = null; };
  }, [router]);

  const login = useCallback(async (u: string, p: string) => {
    const { token: t, user: usr } = await authLogin(u, p);
    localStorage.setItem(TOKEN_KEY, t);
    patchFetch(t);
    setToken(t);
    setUser(usr);
    handlingUnauthorized = false;  // reset so a future expiry can trigger again
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    patchFetch(null);
    setToken(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  const can = useCallback(
    (min: Role) => !enabled || (user ? RANK[user.role] >= RANK[min] : false),
    [enabled, user],
  );

  return (
    <AuthCtx.Provider value={{ enabled, ready, user, token, login, logout, can }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
