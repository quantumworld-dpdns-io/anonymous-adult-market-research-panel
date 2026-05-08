// supabase/functions/verify-researcher-access/index.ts
// JWT verification helper called by backend services to confirm that
// an Authorization: Bearer <token> belongs to a valid researcher.
//
// Returns: { user_id, email } on success, or { error } on failure.
//
// Environment variables required:
//   SUPABASE_URL      — auto-injected
//   SUPABASE_ANON_KEY — auto-injected

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, errorResponse, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  // Extract Bearer token from Authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('Missing or malformed Authorization header', 401);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return errorResponse('Empty token', 401);
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Create a client scoped to the token — getUser() will validate the JWT
  // against Supabase Auth's signing key and return the user if valid.
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    console.warn('[verify-researcher-access] invalid token:', error?.message);
    return errorResponse('Invalid or expired token', 401);
  }

  // Optionally confirm the user has a matching researchers row
  // (created during onboarding). If absent, the user exists in Auth
  // but has not completed researcher onboarding.
  const { data: researcher, error: researcherError } = await supabase
    .from('researchers')
    .select('id, display_name, org_name')
    .eq('id', user.id)
    .maybeSingle();

  if (researcherError) {
    console.error('[verify-researcher-access] DB error:', researcherError.message);
    return errorResponse('Internal error', 500);
  }

  return jsonResponse({
    user_id:      user.id,
    email:        user.email,
    researcher:   researcher ?? null,  // null if onboarding incomplete
    verified_at:  new Date().toISOString(),
  });
});
