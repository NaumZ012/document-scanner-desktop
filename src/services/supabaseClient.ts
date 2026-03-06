import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          company_name: string | null;
          role: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          company_name?: string | null;
          role?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          full_name?: string | null;
          company_name?: string | null;
          role?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      employees: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          pin_hash: string;
          is_active: boolean | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          pin_hash: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          pin_hash?: string;
          is_active?: boolean;
          created_at?: string | null;
        };
        Relationships: [];
      };
      app_sessions: {
        Row: {
          id: string;
          owner_id: string;
          employee_id: string | null;
          started_at: string | null;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          employee_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
        };
        Update: {
          employee_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
        };
        Relationships: [];
      };
      api_calls: {
        Row: {
          id: string;
          owner_id: string;
          employee_id: string | null;
          endpoint: string;
          status_code: number | null;
          file_name: string | null;
          pages: number | null;
          called_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          employee_id?: string | null;
          endpoint: string;
          status_code?: number | null;
          file_name?: string | null;
          pages?: number | null;
          called_at?: string | null;
        };
        Update: {
          status_code?: number | null;
          file_name?: string | null;
          pages?: number | null;
          called_at?: string | null;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          owner_id: string | null;
          event_type: string;
          ip_address: string | null;
          user_agent: string | null;
          metadata: Record<string, unknown> | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          event_type: string;
          ip_address?: string | null;
          user_agent?: string | null;
          metadata?: Record<string, unknown> | null;
          created_at?: string | null;
        };
        Update: {
          event_type?: string;
          ip_address?: string | null;
          user_agent?: string | null;
          metadata?: Record<string, unknown> | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let client: SupabaseClient<Database> | null = null;

export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return { url: supabaseUrl.replace(/\/$/, ""), anonKey: supabaseAnonKey };
}

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    }) as SupabaseClient<Database>;
  }
  return client;
}

