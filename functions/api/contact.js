const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_API_URL = 'https://api.resend.com/emails';
const TO_EMAIL = 'chris@callelectric.net';
const FROM_EMAIL = 'CALL Electric Website <info@hostverna.co>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(value, max = 5000) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

async function verifyTurnstile(secret, token, ip) {
  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (ip) body.set('remoteip', ip);

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body,
  });
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.success);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const resendKey = env.resend_api_key;
  const turnstileSecret = env.turnstile_secret_key;

  if (!resendKey || !turnstileSecret) {
    return json({ ok: false, error: 'Form is not configured.' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body.' }, 400);
  }

  const formName = clean(payload.formName, 120) || 'Contact Form';
  const isSubscribe = /subscribe|newsletter/i.test(formName);
  const name = clean(payload.name, 200) || (isSubscribe ? 'Newsletter subscriber' : '');
  const email = clean(payload.email, 320);
  const phone = clean(payload.phone, 64);
  const subject =
    clean(payload.subject, 200) ||
    (isSubscribe ? 'Newsletter subscription' : 'Website inquiry');
  const message = clean(payload.message, 5000);
  const token = clean(payload.turnstileToken, 2048);

  if (!email || !token) {
    return json({ ok: false, error: 'Missing required fields.' }, 400);
  }

  if (!isSubscribe && !name) {
    return json({ ok: false, error: 'Missing required fields.' }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Invalid email address.' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const human = await verifyTurnstile(turnstileSecret, token, ip);
  if (!human) {
    return json({ ok: false, error: 'Turnstile verification failed.' }, 403);
  }

  const html = isSubscribe
    ? `
      <h2>New newsletter subscription</h2>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Form:</strong> ${escapeHtml(formName)}</p>
    `
    : `
      <h2>New ${escapeHtml(formName)} submission</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message || '—').replace(/\n/g, '<br>')}</p>
    `;

  const text = isSubscribe
    ? [`New newsletter subscription`, `Email: ${email}`, `Form: ${formName}`].join('\n')
    : [
        `New ${formName} submission`,
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone || '—'}`,
        `Subject: ${subject}`,
        '',
        message || '—',
      ].join('\n');

  const resendRes = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: email,
      subject: `[${formName}] ${subject}`,
      html,
      text,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error('Resend error:', resendRes.status, errText);
    return json({ ok: false, error: 'Failed to send email.' }, 502);
  }

  return json({ ok: true });
}
