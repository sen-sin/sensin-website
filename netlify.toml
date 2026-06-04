/**
 * SEN'SIN Stripe Webhook
 * --------------------------------------------------------------
 * Läuft bei jedem erfolgreichen Stripe-Kauf:
 *  1. Erkennt das gekaufte Produkt (Generations Shift oder Leitfäden)
 *  2. Legt einen neuen Supabase-User an (oder erweitert bestehenden)
 *  3. Schickt eine gebrandete Welcome-Mail via Resend
 *
 * Environment-Variables (in Netlify einzurichten):
 *  STRIPE_SECRET_KEY        – aus Stripe (Live oder Test)
 *  STRIPE_WEBHOOK_SECRET    – aus Stripe → Webhooks → "Signing secret"
 *  SUPABASE_URL             – z.B. https://erkdktmrexgbttliswaq.supabase.co
 *  SUPABASE_SERVICE_ROLE_KEY – aus Supabase → Settings → API Keys (service_role!)
 *  RESEND_API_KEY           – aus Resend → API Keys (beginnt mit re_)
 */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const resend = new Resend(process.env.RESEND_API_KEY);

  // --- Stripe-Signatur prüfen ---
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Nur erfolgreiche Käufe interessieren uns
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Event ignored' };
  }

  const session = stripeEvent.data.object;
  const customerEmail = (session.customer_details && session.customer_details.email) || session.customer_email;
  const customerName = (session.customer_details && session.customer_details.name) || 'Liebe Wegbegleiterin / lieber Wegbegleiter';

  if (!customerEmail) {
    console.error('Keine E-Mail in Stripe-Session');
    return { statusCode: 400, body: 'No email' };
  }

  // --- Welches Produkt wurde gekauft? ---
  let productName = '';
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
    productName = (items.data[0] && items.data[0].description) || '';
  } catch (e) {
    console.warn('LineItems fetch fehlgeschlagen:', e.message);
  }
  const nameLow = productName.toLowerCase();
  const flags = {
    hat_generations_shift: nameLow.includes('generations') || nameLow.includes('shift'),
    hat_leitfaeden: nameLow.includes('leitfäden') || nameLow.includes('leitfaeden') || nameLow.includes('bundle')
  };

  // Fallback: Wenn Produkt nicht erkannt, nehmen wir Generations Shift an (höherer Wert)
  if (!flags.hat_generations_shift && !flags.hat_leitfaeden) {
    flags.hat_generations_shift = true;
  }

  // --- Existiert User schon? ---
  const { data: existing } = await supabase
    .from('users')
    .select('id, email, hat_generations_shift, hat_leitfaeden, kaufdatum')
    .eq('email', customerEmail)
    .maybeSingle();

  let isNewUser = false;
  let plainPassword = null;
  let userId = null;

  if (existing) {
    // BESTEHENDER User → Produkt-Flag ergänzen
    userId = existing.id;
    const updates = {};
    if (flags.hat_generations_shift && !existing.hat_generations_shift) {
      updates.hat_generations_shift = true;
      updates.kaufdatum = new Date().toISOString();
    }
    if (flags.hat_leitfaeden && !existing.hat_leitfaeden) {
      updates.hat_leitfaeden = true;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('users').update(updates).eq('id', userId);
    }
  } else {
    // NEUER User → Auth + public.users anlegen
    isNewUser = true;
    plainPassword = generatePassword();

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: customerEmail,
      password: plainPassword,
      email_confirm: true,
      user_metadata: { name: customerName }
    });

    if (authErr || !authData || !authData.user) {
      console.error('Auth-Create-Fehler:', authErr);
      return { statusCode: 500, body: 'User-Anlage fehlgeschlagen' };
    }
    userId = authData.user.id;

    const { error: profileErr } = await supabase.from('users').insert({
      id: userId,
      email: customerEmail,
      name: customerName,
      kaufdatum: new Date().toISOString(),
      produkt: flags.hat_generations_shift ? 'generations_shift' : 'leitfaeden',
      hat_generations_shift: flags.hat_generations_shift,
      hat_leitfaeden: flags.hat_leitfaeden
    });
    if (profileErr) console.error('Profile-Insert-Fehler:', profileErr);
  }

  // --- Welcome-Mail via Resend ---
  try {
    const subject = isNewUser
      ? "Willkommen bei SEN'SIN – dein Zugang"
      : (flags.hat_generations_shift
          ? "Dein SEN'SIN Generations Shift ist freigeschaltet"
          : "Deine SEN'SIN Leitfäden sind freigeschaltet");

    await resend.emails.send({
      from: "SEN'SIN <mesut@sen-sin.com>",
      to: customerEmail,
      subject,
      html: buildWelcomeMail({ name: customerName, email: customerEmail, password: plainPassword, isNewUser, flags })
    });
  } catch (mailErr) {
    console.error('Mail-Versand-Fehler:', mailErr);
    // Wir geben trotzdem 200 zurück, damit Stripe nicht ständig retried
  }

  return { statusCode: 200, body: 'OK' };
};

// ---------------- Helfer ----------------

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

function buildWelcomeMail({ name, email, password, isNewUser, flags }) {
  const firstName = String(name || '').split(' ')[0] || 'Hallo';

  let intro = '';
  if (isNewUser && flags.hat_generations_shift) {
    intro = `<p style="margin:0 0 14px;">${firstName}, dein Weg beginnt jetzt.</p>
             <p style="margin:0 0 14px;">180 Tage. Zwei Durchläufe. Eine tiefe Begleitung – Schritt für Schritt, Tag für Tag.</p>`;
  } else if (isNewUser && flags.hat_leitfaeden) {
    intro = `<p style="margin:0 0 14px;">${firstName}, willkommen bei SEN'SIN.</p>
             <p style="margin:0 0 14px;">Deine Leitfäden sind ab sofort in deinem persönlichen Raum verfügbar – eine wachsende Bibliothek, die mit dir mitwächst.</p>`;
  } else if (!isNewUser && flags.hat_generations_shift) {
    intro = `<p style="margin:0 0 14px;">${firstName}, dein Generations Shift ist jetzt freigeschaltet.</p>
             <p style="margin:0 0 14px;">Logge dich in deinen bekannten Mein Raum ein – dein Weg beginnt mit Tag 1.</p>`;
  } else {
    intro = `<p style="margin:0 0 14px;">${firstName}, deine SEN'SIN Leitfäden sind nun in deinem bestehenden Zugang verfügbar.</p>
             <p style="margin:0 0 14px;">Logge dich ein und du findest sie unter „Dein Zugang".</p>`;
  }

  const credentials = isNewUser ? `
    <table cellpadding="0" cellspacing="0" style="width:100%;background:linear-gradient(180deg,#FBF6EC 0%,#F6F0E4 100%);border:1px solid rgba(232,176,75,.4);border-radius:14px;margin:28px 0;">
      <tr><td style="padding:24px 26px;">
        <div style="font-family:'Manrope',Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#B5852A;text-transform:uppercase;margin-bottom:14px;">Deine Zugangsdaten</div>
        <div style="font-family:'Manrope',Arial,sans-serif;font-size:14px;color:#0E2350;line-height:2;">
          <strong>Mein Raum:</strong> <a href="https://sen-sin.com" style="color:#B5852A;text-decoration:none;">https://sen-sin.com</a><br>
          <strong>E-Mail:</strong> ${email}<br>
          <strong>Passwort:</strong> <code style="background:#fff;padding:5px 12px;border-radius:6px;font-family:Courier,monospace;font-size:14px;color:#0A1A3D;border:1px solid rgba(232,176,75,.3);">${password}</code>
        </div>
        <p style="margin:18px 0 0;font-size:12.5px;color:#7a6a4a;font-style:italic;">Bitte ändere dein Passwort nach dem ersten Login.</p>
      </td></tr>
    </table>` : '';

  const closing = isNewUser && flags.hat_generations_shift
    ? `<p style="margin:14px 0;">Beim ersten Login wartet deine Bestandsanalyse auf dich. Nimm dir 15 Minuten Zeit – sie wird dein Anker. Am Ende deines Wegs machst du sie erneut, und du wirst sehen, was sich verändert hat.</p>
       <p style="margin:14px 0;">Tag für Tag wird ein neuer Inhalt freigeschaltet. Keine Eile. Keine Überforderung. Du bist nicht allein – ich begleite dich.</p>`
    : '<p style="margin:14px 0;">Wenn du Fragen hast oder ein Thema fehlt, schreib mir – passende Inhalte ergänze ich laufend.</p>';

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Willkommen bei SEN'SIN</title></head>
<body style="margin:0;padding:0;background:#F6F0E4;font-family:'Manrope',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#0A1A3D;line-height:1.65;">
<table cellpadding="0" cellspacing="0" style="width:100%;background:#F6F0E4;padding:40px 16px;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(14,35,80,.08);">
<tr><td style="padding:48px 36px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="display:inline-block;border:1.5px solid #E8B04B;padding:14px 28px;letter-spacing:8px;font-family:Georgia,'Cormorant Garamond',serif;font-size:22px;color:#E8B04B;">SEN'SIN</div>
  </div>
  <h1 style="font-family:Georgia,'Cormorant Garamond',serif;font-weight:400;font-size:30px;color:#0E2350;text-align:center;margin:0 0 28px;letter-spacing:.5px;">Willkommen.</h1>
  ${intro}
  ${credentials}
  ${closing}
  <div style="text-align:center;margin:32px 0 12px;">
    <a href="https://sen-sin.com" style="display:inline-block;background:#E8B04B;color:#0E2350;padding:14px 32px;text-decoration:none;border-radius:999px;font-weight:600;letter-spacing:.5px;font-family:'Manrope',Arial,sans-serif;font-size:14px;">Zum Mein Raum →</a>
  </div>
  <p style="margin:28px 0 0;">Mit klarem Herzen,<br><strong>Mesut Sen</strong><br><em style="color:#888;font-size:13px;">SEN'SIN</em></p>
  <hr style="border:0;border-top:1px solid #eee;margin:36px 0 16px;">
  <p style="font-size:11px;color:#999;text-align:center;line-height:1.6;margin:0;">SEN'SIN · Mesut Sen · Kreuzstr. 52 · 46483 Wesel<br>sensin.team@outlook.de · <a href="https://sen-sin.com" style="color:#999;">sen-sin.com</a></p>
</td></tr></table>
</td></tr></table>
</body></html>`;
}
