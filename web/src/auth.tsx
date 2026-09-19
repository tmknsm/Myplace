import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, type User } from "./api";
import { cacheClear } from "./query-cache";

interface AuthState {
  user: User | null;
  ready: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = async () => {
    const data = await api.me();
    setUser(data.user);
    setReady(true);
  };

  useEffect(() => {
    refresh().catch(() => setReady(true));
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    ready,
    refresh,
    signOut: async () => {
      await api.signOut();
      cacheClear();
      setUser(null);
    },
  }), [user, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
