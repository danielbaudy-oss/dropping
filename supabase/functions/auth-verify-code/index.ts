/* Edge Function: auth-verify-code
   Body: { chatId: string, code: string }
   Verifies the code and issues a session token. */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'dropping' },
  auth: { persistSession: false }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { chatId?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const chatId = String(body.chatId || '').trim();
  const code = String(body.code || '').trim();
  if (!chatId || !code) return json({ error: 'Missing chatId or code' }, 400);

  // Verify code
  const { data: codeRow } = await supabase
    .from('auth_codes')
    .select('code, expires_at')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!codeRow) return json({ error: 'No code requested. Request one first.' }, 400);
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    return json({ error: 'Code expired. Request a new one.' }, 400);
  }
  if (codeRow.code !== code) return json({ error: 'Invalid code' }, 400);

  // Issue session token (30-day expiry)
  const token = randomToken();
  const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('sessions').insert({
    token,
    chat_id: chatId,
    expires_at: sessionExpiresAt
  });

  // Delete used code
  await supabase.from('auth_codes').delete().eq('chat_id', chatId);

  return json({
    ok: true,
    token,
    chatId,
    expiresAt: sessionExpiresAt
  });
});
