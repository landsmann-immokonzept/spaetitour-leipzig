/**
 * Cloudflare Worker: Stripe Webhook -> personalisierte Tour-HTML -> Email
 *
 * Flow:
 * 1. Stripe sendet checkout.session.completed Webhook
 * 2. Worker extrahiert Käufername + Email
 * 3. Worker holt tour.html Template aus R2
 * 4. Ersetzt Wasserzeichen-Platzhalter mit Käufername
 * 5. Speichert personalisierte HTML unter einzigartigem Key in R2
 * 6. Sendet Email mit Tour-Link an Käufer
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Tour-Seiten ausliefern: GET /tour/{id}
    if (request.method === 'GET' && url.pathname.startsWith('/tour/')) {
      const tourId = url.pathname.replace('/tour/', '');
      return serveTour(tourId, env);
    }

    // Stripe Webhook: POST /webhook/stripe
    if (request.method === 'POST' && url.pathname === '/webhook/stripe') {
      return handleStripeWebhook(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleStripeWebhook(request, env) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return new Response('No signature', { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('Ignored event type', { status: 200 });
  }

  const session = event.data.object;
  const kaeuferName = session.customer_details?.name || 'Spätitour-Gast';
  const kaeuferEmail = session.customer_details?.email;

  if (!kaeuferEmail) {
    return new Response('No email in session', { status: 400 });
  }

  const tourId = generateTourId();

  const template = await env.TOURS.get('template/tour.html');
  if (!template) {
    return new Response('Template not found in R2', { status: 500 });
  }

  let html = await template.text();
  html = html.replaceAll('__KAEUFER_NAME__', escapeHtml(kaeuferName));

  await env.TOURS.put(`tours/${tourId}.html`, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  await sendTourEmail(env, kaeuferEmail, kaeuferName, tourId);

  return new Response(JSON.stringify({ ok: true, tourId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function serveTour(tourId, env) {
  if (!/^[a-z0-9]+$/.test(tourId)) {
    return new Response('Invalid tour ID', { status: 400 });
  }

  const tour = await env.TOURS.get(`tours/${tourId}.html`);
  if (!tour) {
    return new Response('Tour nicht gefunden', { status: 404 });
  }

  return new Response(tour.body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

function generateTourId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (const byte of array) {
    id += chars[byte % chars.length];
  }
  return id;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendTourEmail(env, to, name, tourId) {
  const tourUrl = `${env.SITE_URL}/tour/${tourId}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      subject: 'Eure Leipziger Spätitour ist bereit!',
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px;">Hey ${escapeHtml(name)}!</h1>
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            Eure Spätitour ist startklar. Öffnet den Link wenn ihr loslegen wollt &ndash;
            die Route wird bei jedem Start neu gewürfelt.
          </p>
          <a href="${tourUrl}" style="display: inline-block; background: #f59e0b; color: #000; font-weight: bold; padding: 16px 32px; border-radius: 50px; text-decoration: none; font-size: 18px; margin: 24px 0;">
            Tour starten
          </a>
          <p style="color: #999; font-size: 14px; margin-top: 32px;">
            Tipp: Speichert den Link &ndash; ihr könnt die Tour so oft spielen wie ihr wollt.
            Jedes Mal andere Route, andere Aufgaben.
          </p>
          <p style="color: #ccc; font-size: 12px; margin-top: 40px;">
            Leipziger Spätitour | <a href="${env.SITE_URL}" style="color: #ccc;">spaetitour-leipzig.de</a>
          </p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    console.error('Email send failed:', await response.text());
  }
}
