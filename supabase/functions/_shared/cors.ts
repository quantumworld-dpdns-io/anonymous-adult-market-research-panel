// supabase/functions/_shared/cors.ts
// Shared CORS headers for all Edge Functions.
// Import with: import { corsHeaders, handleCors } from '../_shared/cors.ts'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-service-hmac',
  'Access-Control-Max-Age': '86400',
};

/**
 * Returns a CORS preflight response for OPTIONS requests,
 * or null if the request is not a preflight.
 *
 * Usage:
 *   const preflight = handleCors(req);
 *   if (preflight) return preflight;
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

/**
 * Wraps a response with CORS headers.
 */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Returns a JSON error response with CORS headers.
 */
export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Returns a JSON success response with CORS headers.
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
