/* Edge Function: auth-request-code
   Body: { chatId: string }
   Sends a 6-digit code to the Telegram user and stores it in dropping.auth_codes.
   If the user doesn't exist yet, creates them. */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'dropping' },
  auth: { persistSession: false }
});

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

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

async function getBotToken(): Promise<string | null> {
  const { data } = await supabase.from('config').select('value').eq('key', 'bot_token').maybeSingle();
  return data?.value ?? null;
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
  const result = await res.json();
  return result.ok === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { chatId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const chatId = String(body.chatId || '').trim();
  if (!chatId || !/^\d+$/.test(chatId)) {
    return json({ error: 'Chat ID must be a number' }, 400);
  }

  const token = await getBotToken();
  if (!token) return json({ error: 'Bot not configured' }, 500);

  // Ensure user row exists
  const { data: existing } = await supabase.from('users').select('chat_id').eq('chat_id', chatId).maybeSingle();
  if (!existing) {
    const apiSecret = crypto.randomUUID().substring(0, 16);
    await supabase.from('users').insert({
      chat_id: chatId,
      api_secret: apiSecret,
      region: 'es'
    });
  }

  // Generate and store code (5 min expiry)
  const code = randomCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await supabase.from('auth_codes').upsert({
    chat_id: chatId,
    code,
    expires_at: expiresAt,
    created_at: new Date().toISOString()
  });

  // Send via Telegram
  const text = `🔐 *Your dropping login code*\n\n*${code}*\n\nExpires in 5 minutes.`;
  const sent = await sendTelegram(token, chatId, text);
  if (!sent) {
    return json({
      error: 'Could not send message to this Chat ID. Make sure you messaged the bot first.'
    }, 400);
  }

  return json({ ok: true });
});
