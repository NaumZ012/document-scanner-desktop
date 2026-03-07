import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient, type Database } from "@/services/supabaseClient";
import { logAuditEvent } from "@/services/audit";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signUp: (params: { email: string; password: string; fullName?: string }) => Promise<{ error?: string }>;
  signIn: (params: { email: string; password: string }) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function toFriendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "Invalid email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email address and try again.";
  if (m.includes("user already registered")) return "An account with this email already exists. Sign in instead.";
  if (m.includes("password")) return "Please check your password and try again.";
  if (m.includes("network") || m.includes("fetch")) return "Network error. Check your connection and try again.";
  return message;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const AUTH_TIMEOUT_MS = 10000;

  const withAuthTimeout = async <T,>(promise: Promise<T>, message: string): Promise<T> =>
    await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(message));
      }, AUTH_TIMEOUT_MS);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadProfile = async (userId: string) => {
      try {
        // profiles.id = auth.uid(); RLS allows only own row.
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();
        if (!active) return;
        if (error) {
          setProfile(null);
        } else {
          setProfile(data as Profile);
        }
      } catch {
        if (!active) return;
        setProfile(null);
      }
    };

    const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> =>
      await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Supabase getSession timeout"));
        }, ms);
        promise
          .then((value) => {
            clearTimeout(timer);
            resolve(value);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });

    const init = async () => {
      try {
        const {
          data: { session: initialSession },
          error,
        } = await withTimeout(supabase.auth.getSession(), 5000);
        if (!active) return;
        if (error) {
          // Treat Supabase errors as "not logged in" but don't block the UI.
          setSession(null);
          setUser(null);
          setProfile(null);
          return;
        }
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        if (initialSession?.user) {
          await loadProfile(initialSession.user.id);
        }
      } catch {
        if (!active) return;
        setSession(null);
        setUser(null);
        setProfile(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void init();

    const {
      data: authListener,
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        await loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  const signUp: AuthContextValue["signUp"] = async ({ email, password, fullName }) => {
    const client = getSupabaseClient();
    if (!client) return { error: "Supabase is not configured." };
    try {
      const { error } = await withAuthTimeout(
        client.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        }),
        "Sign up timed out. Please check your internet connection and try again.",
      );
      if (error) {
        return { error: toFriendlyAuthError(error.message) };
      }
      return {};
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: toFriendlyAuthError(msg) || "Sign up failed. Please try again." };
    }
  };

  const signIn: AuthContextValue["signIn"] = async ({ email, password }) => {
    const client = getSupabaseClient();
    if (!client) return { error: "Service is not configured. Please try again later." };
    try {
      const { error } = await withAuthTimeout(
        client.auth.signInWithPassword({ email, password }),
        "Sign in timed out. Please check your internet connection and try again.",
      );
      if (error) {
        return { error: toFriendlyAuthError(error.message) };
      }
      return {};
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: toFriendlyAuthError(msg) || "Sign in failed. Please try again." };
    }
  };

  const signOut = async () => {
    const client = getSupabaseClient();
    if (client) {
      try {
        const { data } = await client.auth.getSession();
        if (data.session?.access_token) {
          await logAuditEvent({ eventType: "logout", accessToken: data.session.access_token });
        }
        await client.auth.signOut();
      } catch {
        // Proceed to clear local state
      }
    }
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  const refreshProfile = async () => {
    const client = getSupabaseClient();
    if (!client || !user) return;
    const { data, error } = await client
      .from("profiles")
      .select("*")
      .eq("id", user.id) // profiles.id = auth.uid()
      .single();
    if (error) return;
    setProfile(data as Profile);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

