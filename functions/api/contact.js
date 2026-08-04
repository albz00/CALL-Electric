/**
 * Mirrors the working Knight Henderson Pages Function pattern:
 * direct env.resend_api_key / env.turnstile_secret_key, FormData Turnstile verify, Resend send.
 */

const TO_EMAIL = 'chris@callelectric.net';
const FROM_EMAIL = 'CALL Electric Website <info@hostverna.co>';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function jsonResponse(body, status) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function clean(value, max = 5000) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

export const onRequestPost = async ({ request, env }) => {
  if (!env.resend_api_key || !env.turnstile_secret_key) {
    console.error('Missing Resend or Turnstile secret binding.');
    return jsonResponse(
      { ok: false, error: 'The contact form is temporarily unavailable.' },
      500
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid form submission.' }, 400);
  }

  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ ok: false, error: 'Invalid form submission.' }, 400);
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
  const turnstileToken = clean(payload.turnstileToken, 2048);

  if (!email || !turnstileToken) {
    return jsonResponse({ ok: false, error: 'Please complete all required fields.' }, 400);
  }
  if (!isSubscribe && !name) {
    return jsonResponse({ ok: false, error: 'Please complete all required fields.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
  }

  const verificationBody = new FormData();
  verificationBody.set('secret', env.turnstile_secret_key);
  verificationBody.set('response', turnstileToken);

  const remoteIp = request.headers.get('CF-Connecting-IP');
  if (remoteIp) {
    verificationBody.set('remoteip', remoteIp);
  }

  const verificationResponse = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: verificationBody }
  );
  const verification = await verificationResponse.json();

  if (!verificationResponse.ok || !verification.success) {
    return jsonResponse(
      { ok: false, error: 'The security check failed. Please try again.' },
      400
    );
  }

  const html = isSubscribe
    ? `<h2>New newsletter subscription</h2>
       <p><strong>Email:</strong> ${escapeHtml(email)}</p>
       <p><strong>Form:</strong> ${escapeHtml(formName)}</p>`
    : `<h2>New ${escapeHtml(formName)} submission</h2>
       <table style="border-collapse:collapse;width:100%;max-width:680px">
         <tr><th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Name</th><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(name)}</td></tr>
         <tr><th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Email</th><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(email)}</td></tr>
         <tr><th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Phone</th><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(phone || '—')}</td></tr>
         <tr><th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Subject</th><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(subject)}</td></tr>
         <tr><th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Message</th><td style="padding:8px;white-space:pre-wrap;border-bottom:1px solid #ddd">${escapeHtml(message || '—')}</td></tr>
       </table>`;

  const text = isSubscribe
    ? `New newsletter subscription\nEmail: ${email}\nForm: ${formName}`
    : `New ${formName} submission\nName: ${name}\nEmail: ${email}\nPhone: ${phone || '—'}\nSubject: ${subject}\n\n${message || '—'}`;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resend_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: email,
      subject: `Website: ${formName}${subject ? ` — ${subject}` : ''}`,
      text,
      html,
    }),
  });

  if (!resendResponse.ok) {
    console.error('Resend request failed:', resendResponse.status, await resendResponse.text());
    return jsonResponse(
      { ok: false, error: 'Your message could not be sent. Please try again.' },
      502
    );
  }

  return jsonResponse({ ok: true, message: 'Message sent.' }, 200);
};
