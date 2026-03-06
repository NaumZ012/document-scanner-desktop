import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient, type Database } from "@/services/supabaseClient";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadProfile = async (userId: string) => {
      try {
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
    const { error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });
    if (error) {
      return { error: error.message };
    }
    return {};
  };

  const signIn: AuthContextValue["signIn"] = async ({ email, password }) => {
    const client = getSupabaseClient();
    if (!client) return { error: "Supabase is not configured." };
    const { error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return { error: error.message };
    }
    return {};
  };

  const signOut = async () => {
    setSession(null);
    setUser(null);
    setProfile(null);
    const client = getSupabaseClient();
    if (client) {
      try {
        await client.auth.signOut();
      } catch {
        // Already cleared local state; app will show auth screen
      }
    }
  };

  const refreshProfile = async () => {
    const client = getSupabaseClient();
    if (!client || !user) return;
    const { data, error } = await client
      .from("profiles")
      .select("*")
      .eq("id", user.id)
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

