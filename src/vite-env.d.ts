/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly TAURI_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "bcryptjs" {
  export function hash(s: string, rounds: number): Promise<string>;
  export function hash(s: string, rounds: number, callback: (err: Error | null, hash: string) => void): void;
  export function hashSync(s: string, rounds?: number): string;
  export function compare(s: string, hash: string): Promise<boolean>;
  export function compare(s: string, hash: string, callback: (err: Error | null, result: boolean) => void): void;
  export function compareSync(s: string, hash: string): boolean;
}
