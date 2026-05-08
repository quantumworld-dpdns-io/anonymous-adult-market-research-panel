// supabase/functions/on-response-submitted/index.ts
// Triggered by a Supabase Database Webhook on INSERT to public.encrypted_responses.
//
// Webhook payload shape (Supabase v2):
//   { type: "INSERT", table: "encrypted_responses", record: { id, study_id, submitted_at }, ... }
//
// Responsibilities:
//   1. Count total responses for the study.
//   2. If count >= study.min_responses, call Analytics Service to trigger FL round.
//
// Environment variables required:
//   SUPABASE_URL               — auto-injected by Supabase runtime
//   SUPABASE_SERVICE_ROLE_KEY  — auto-injected by Supabase runtime
//   ANALYTICS_SERVICE_URL      — internal URL of the Python Analytics service
//   SERVICE_HMAC_SECRET        — shared secret for X-Service-HMAC header

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, errorResponse, jsonResponse } from '../_shared/cors.ts';

// HMAC-SHA256 for service-to-service authentication
async function computeServiceHmac(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    keyMaterial,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  const preflight = handleCors(req);
  if (preflight) return preflight;

  // Only accept POST (webhook delivery)
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  let body: { type?: string; table?: string; record?: { study_id?: string } };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON payload', 400);
  }

  // Validate webhook shape
  if (body.type !== 'INSERT' || body.table !== 'encrypted_responses') {
    return errorResponse('Unexpected webhook event', 400);
  }

  const studyId = body.record?.study_id;
  if (!studyId) {
    return errorResponse('Missing study_id in webhook record', 400);
  }

  const supabaseUrl   = Deno.env.get('SUPABASE_URL')!;
  const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const analyticsUrl  = Deno.env.get('ANALYTICS_SERVICE_URL');
  const hmacSecret    = Deno.env.get('SERVICE_HMAC_SECRET') ?? '';

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 1. Count total responses for this study
  const { count, error: countError } = await supabase
    .from('encrypted_responses')
    .select('id', { count: 'exact', head: true })
    .eq('study_id', studyId);

  if (countError) {
    console.error('[on-response-submitted] count error:', countError.message);
    return errorResponse('DB count error', 500);
  }

  // 2. Fetch study threshold
  const { data: study, error: studyError } = await supabase
    .from('studies')
    .select('min_responses, status')
    .eq('id', studyId)
    .single();

  if (studyError || !study) {
    console.error('[on-response-submitted] study fetch error:', studyError?.message);
    return errorResponse('Study not found', 404);
  }

  if (study.status !== 'active') {
    return jsonResponse({ triggered: false, reason: 'study_not_active' });
  }

  const responseCount = count ?? 0;

  console.log(`[on-response-submitted] study=${studyId} count=${responseCount} min=${study.min_responses}`);

  // 3. Trigger federated analytics round when threshold is reached
  //    (also on every subsequent batch of min_responses to produce updated results)
  if (responseCount >= study.min_responses && responseCount % study.min_responses === 0) {
    if (!analyticsUrl) {
      console.warn('[on-response-submitted] ANALYTICS_SERVICE_URL not set, skipping trigger');
      return jsonResponse({ triggered: false, reason: 'analytics_url_not_configured' });
    }

    const triggerPath = `/analytics/${studyId}/trigger-round`;
    const hmac = await computeServiceHmac(triggerPath, hmacSecret);

    try {
      const triggerRes = await fetch(`${analyticsUrl}${triggerPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-HMAC': hmac,
        },
        body: JSON.stringify({ response_count: responseCount }),
      });

      if (!triggerRes.ok) {
        const errText = await triggerRes.text();
        console.error('[on-response-submitted] analytics trigger failed:', errText);
        return errorResponse('Analytics trigger failed', 502);
      }

      console.log(`[on-response-submitted] FL round triggered for study=${studyId}`);
      return jsonResponse({ triggered: true, response_count: responseCount });
    } catch (fetchErr) {
      console.error('[on-response-submitted] fetch error:', fetchErr);
      return errorResponse('Failed to reach Analytics Service', 502);
    }
  }

  return jsonResponse({
    triggered: false,
    response_count: responseCount,
    threshold: study.min_responses,
  });
});
