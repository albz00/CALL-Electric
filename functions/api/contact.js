/**
 * CALL Electric contact form → Resend + Turnstile
 * Pages Function at POST /api/contact
 *
 * Requires Pages Variables (Production / Runtime):
 *   resend_api_key
 *   turnstile_secret_key
 */

const TO_EMAIL = 'chris@callelectric.net';
const FROM_EMAIL = 'CALL Electric Website <info@hostverna.co>';

const RESEND_URL = 'https://api.resend.com/emails';
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function text(value, max) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value == null ? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Read a Pages Variable / Secret from env (exact name, then case-insensitive). */
function readEnv(env, wanted) {
  if (!env) return '';

  const direct = env[wanted];
  if (direct != null && String(direct).trim()) return String(direct).trim();

  const upper = wanted.toUpperCase();
  const upperVal = env[upper];
  if (upperVal != null && String(upperVal).trim()) return String(upperVal).trim();

  try {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === wanted.toLowerCase()) {
        const val = env[key];
        if (val != null && String(val).trim()) return String(val).trim();
      }
    }
  } catch {
    /* env proxy may not enumerate */
  }

  return '';
}

function bindings(env) {
  try {
    return Object.keys(env || {}).sort();
  } catch {
    return [];
  }
}

async function verifyTurnstile(secret, token, ip) {
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  const res = await fetch(TURNSTILE_URL, { method: 'POST', body });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

async function sendEmail(apiKey, { formName, name, email, phone, subject, message, isSubscribe }) {
  const html = isSubscribe
    ? `<h2>New newsletter subscription</h2>
       <p><strong>Email:</strong> ${escapeHtml(email)}</p>
       <p><strong>Form:</strong> ${escapeHtml(formName)}</p>`
    : `<h2>New ${escapeHtml(formName)} submission</h2>
       <p><strong>Name:</strong> ${escapeHtml(name)}</p>
       <p><strong>Email:</strong> ${escapeHtml(email)}</p>
       <p><strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>
       <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
       <p><strong>Message:</strong></p>
       <p>${escapeHtml(message || '—').replace(/\n/g, '<br>')}</p>`;

  const plain = isSubscribe
    ? `New newsletter subscription\nEmail: ${email}\nForm: ${formName}`
    : `New ${formName} submission\nName: ${name}\nEmail: ${email}\nPhone: ${phone || '—'}\nSubject: ${subject}\n\n${message || '—'}`;

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: email,
      subject: `[${formName}] ${subject}`,
      html,
      text: plain,
    }),
  });

  if (!res.ok) {
    console.error('Resend failed', res.status, await res.text());
    return false;
  }
  return true;
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const resendKey = readEnv(env, 'resend_api_key');
  const turnstileSecret = readEnv(env, 'turnstile_secret_key');

  // Browser / health check — confirms the Function and whether vars are bound.
  if (method === 'GET') {
    return json({
      ok: true,
      service: 'contact',
      configured: Boolean(resendKey && turnstileSecret),
      hasResend: Boolean(resendKey),
      hasTurnstile: Boolean(turnstileSecret),
      bindings: bindings(env),
    });
  }

  if (method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  if (!resendKey || !turnstileSecret) {
    return json(
      {
        ok: false,
        error: 'Form is not configured.',
        hasResend: Boolean(resendKey),
        hasTurnstile: Boolean(turnstileSecret),
        bindings: bindings(env),
      },
      500
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body.' }, 400);
  }

  const formName = text(body.formName, 120) || 'Contact Form';
  const isSubscribe = /subscribe|newsletter/i.test(formName);
  const name = text(body.name, 200) || (isSubscribe ? 'Newsletter subscriber' : '');
  const email = text(body.email, 320);
  const phone = text(body.phone, 64);
  const subject =
    text(body.subject, 200) ||
    (isSubscribe ? 'Newsletter subscription' : 'Website inquiry');
  const message = text(body.message, 5000);
  const turnstileToken = text(body.turnstileToken, 2048);

  if (!email || !turnstileToken) {
    return json({ ok: false, error: 'Missing required fields.' }, 400);
  }
  if (!isSubscribe && !name) {
    return json({ ok: false, error: 'Missing required fields.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Invalid email address.' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const human = await verifyTurnstile(turnstileSecret, turnstileToken, ip);
  if (!human) {
    return json({ ok: false, error: 'Turnstile verification failed.' }, 403);
  }

  const sent = await sendEmail(resendKey, {
    formName,
    name,
    email,
    phone,
    subject,
    message,
    isSubscribe,
  });

  if (!sent) {
    return json({ ok: false, error: 'Failed to send email.' }, 502);
  }

  return json({ ok: true });
}
