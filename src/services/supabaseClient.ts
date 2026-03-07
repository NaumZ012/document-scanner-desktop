import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Single Supabase client used by the whole app. It is initialized with the anon key and
 * auth options (persistSession, autoRefreshToken). Once the user signs in, the client
 * stores the session and automatically attaches the JWT to every request (.from(), .rpc(),
 * .functions.invoke()). All table queries must filter by owner_id = auth.uid() (or, for
 * profiles, by id = auth.uid()) so RLS can enforce the same.
 */

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
          device_id: string | null;
          device_label: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          employee_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          device_id?: string | null;
          device_label?: string | null;
        };
        Update: {
          employee_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          device_id?: string | null;
          device_label?: string | null;
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
      scan_events: {
        Row: {
          id: string;
          owner_id: string;
          session_id: string | null;
          created_at: string | null;
          document_type: string | null;
          file_name: string | null;
          pages: number | null;
          status: string;
          duration_ms: number | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          session_id?: string | null;
          created_at?: string | null;
          document_type?: string | null;
          file_name?: string | null;
          pages?: number | null;
          status: string;
          duration_ms?: number | null;
          error_message?: string | null;
        };
        Update: {
          session_id?: string | null;
          document_type?: string | null;
          file_name?: string | null;
          pages?: number | null;
          status?: string;
          duration_ms?: number | null;
          error_message?: string | null;
        };
        Relationships: [];
      };
      scans: {
        Row: {
          id: string;
          owner_id: string;
          employee_id: string | null;
          session_id: string | null;
          document_type: string;
          file_name: string | null;
          pages: number | null;
          status: string;
          ocr_model: string | null;
          excel_profile_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          employee_id?: string | null;
          session_id?: string | null;
          document_type: string;
          file_name?: string | null;
          pages?: number | null;
          status?: string;
          ocr_model?: string | null;
          excel_profile_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          employee_id?: string | null;
          session_id?: string | null;
          document_type?: string;
          file_name?: string | null;
          pages?: number | null;
          status?: string;
          ocr_model?: string | null;
          excel_profile_id?: string | null;
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
    // Session (and JWT) is sent on every request automatically when the user is signed in.
  }
  return client;
}

