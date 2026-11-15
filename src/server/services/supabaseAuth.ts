import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedAnonClient: SupabaseClient | null = null;
let cachedAdminClient: SupabaseClient | null = null;

export function isSupabaseAuthConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  return Boolean(url && anonKey && /^https?:\/\//i.test(url));
}

function getSupabaseAnonClient(): SupabaseClient {
  if (!isSupabaseAuthConfigured()) {
    throw new Error('Supabase Auth is not configured.');
  }
  if (!cachedAnonClient) {
    cachedAnonClient = createClient(
      process.env.SUPABASE_URL!.trim(),
      process.env.SUPABASE_ANON_KEY!.trim(),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  }
  return cachedAnonClient;
}

function getSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey || !/^https?:\/\//i.test(url)) return null;
  if (!cachedAdminClient) {
    cachedAdminClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return cachedAdminClient;
}

export interface SupabaseAuthResult {
  supabaseUid: string;
  email: string;
  name: string;
  mobileNumber?: string;
  hasSession: boolean;
}

export async function supabaseSignUpCustomer(input: {
  name: string;
  email: string;
  password: string;
  mobileNumber?: string;
  redirectTo?: string;
}): Promise<SupabaseAuthResult> {
  const client = getSupabaseAnonClient();
  const normalizedEmail = input.email.trim().toLowerCase();

  const { data, error } = await client.auth.signUp({
    email: normalizedEmail,
    password: input.password,
    options: {
      emailRedirectTo: input.redirectTo,
      data: {
        full_name: input.name.trim(),
        mobile_number: input.mobileNumber?.trim() || null,
        role: 'BUYER',
      },
    },
  });

  if (error) {
    const err = new Error(error.message || 'Customer sign up failed.') as Error & { status?: number };
    err.status = error.status || 400;
    throw err;
  }

  if (!data.user) {
    throw new Error('Supabase did not return a user record.');
  }

  return {
    supabaseUid: data.user.id,
    email: data.user.email || normalizedEmail,
    name:
      (data.user.user_metadata?.full_name as string | undefined)?.trim() ||
      input.name.trim(),
    mobileNumber:
      (data.user.user_metadata?.mobile_number as string | undefined) ||
      input.mobileNumber?.trim() ||
      undefined,
    hasSession: Boolean(data.session),
  };
}

export async function supabaseSignInWithPassword(input: {
  email: string;
  password: string;
}): Promise<SupabaseAuthResult> {
  const client = getSupabaseAnonClient();
  const normalizedEmail = input.email.trim().toLowerCase();

  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password: input.password,
  });

  if (error || !data.user) {
    const err = new Error(error?.message || 'Invalid email or password.') as Error & {
      status?: number;
    };
    err.status = error?.status || 401;
    throw err;
  }

  return {
    supabaseUid: data.user.id,
    email: data.user.email || normalizedEmail,
    name:
      (data.user.user_metadata?.full_name as string | undefined)?.trim() ||
      normalizedEmail.split('@')[0],
    mobileNumber:
      (data.user.user_metadata?.mobile_number as string | undefined) || undefined,
    hasSession: Boolean(data.session),
  };
}

export async function supabaseGetUserByIdAdmin(supabaseUid: string) {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.auth.admin.getUserById(supabaseUid);
  if (error || !data.user) return null;
  return data.user;
}


export async function supabaseGetUserFromAccessToken(accessToken: string): Promise<SupabaseAuthResult> {
  const client = getSupabaseAnonClient();
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user || !data.user.email) {
    const err = new Error(error?.message || 'The social account did not return a verified email.') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  const metadata = data.user.user_metadata || {};
  const email = data.user.email.trim().toLowerCase();
  return {
    supabaseUid: data.user.id,
    email,
    name:
      (metadata.full_name as string | undefined)?.trim() ||
      (metadata.name as string | undefined)?.trim() ||
      email.split('@')[0],
    mobileNumber: (metadata.mobile_number as string | undefined) || undefined,
    hasSession: true,
  };
}
