const fs = require('fs');
const https = require('https');
const nodemailer = require('nodemailer');
const path = require('path');
const pool = require('../../config/db');

const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://carely-frontend-ytei.vercel.app' : 'http://localhost:5173');
const CARELY_LOGO_URL = 'https://files.catbox.moe/xqe1zq.png';

/**
 * Get active SMTP settings from DB (system_settings) or environment variables.
 * Sender is configured as carelycorp237@gmail.com
 */
async function getSmtpConfig() {
  let dbSettings = null;
  try {
    const { rows } = await pool.query("SELECT value FROM system_settings WHERE key = 'smtp_settings'");
    if (rows.length > 0 && rows[0].value) {
      dbSettings = rows[0].value;
    }
  } catch (err) {
    console.warn('Could not load SMTP settings from DB, checking environment:', err.message);
  }

  const host = dbSettings?.host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(dbSettings?.port || process.env.SMTP_PORT || '465', 10);
  const user = dbSettings?.user || process.env.SMTP_USER || 'carelycorp237@gmail.com';
  const pass = dbSettings?.pass || process.env.SMTP_PASS || '';
  const from = dbSettings?.from || process.env.SMTP_FROM || 'Carely Support <carelycorp237@gmail.com>';
  const secure = port === 465 || dbSettings?.secure === true || process.env.SMTP_SECURE === 'true';

  return { host, port, user, pass, from, secure };
}

/**
 * Create a nodemailer transporter.
 * Configured with IPv4 enforcement and connection timeouts so it never hangs
 * indefinitely on cloud hosts (like Render) that drop outbound SMTP packets.
 */
async function createTransporter() {
  const config = await getSmtpConfig();
  if (!config.user || !config.pass) {
    return { transporter: null, config, hasCredentials: false };
  }

  const isGmail = config.host?.includes('gmail') || config.user?.includes('@gmail.com');

  const transportOptions = isGmail
    ? {
        service: 'gmail',
        auth: {
          user: config.user,
          pass: config.pass,
        },
        family: 4, // Force IPv4 to prevent IPv6 routing blackholes on Render/cloud
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      }
    : {
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
        family: 4,
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
        tls: {
          rejectUnauthorized: false,
        },
      };

  const transporter = nodemailer.createTransport(transportOptions);

  return { transporter, config, hasCredentials: true };
}

/**
 * Dispatch email via HTTP API (Resend or Brevo) if configured.
 * Cloud hosts like Render Free Tier block outbound SMTP ports (25, 465, 587),
 * but HTTP APIs on port 443 are never blocked.
 */
async function sendViaHttpProvider({ to, subject, html, text }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const brevoApiKey = process.env.BREVO_API_KEY;

  if (resendApiKey) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        from: process.env.RESEND_FROM || 'Carely Support <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
        text,
      });
      const req = https.request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve({ sent: true, mode: 'resend', messageId: data.id });
            } catch {
              resolve({ sent: true, mode: 'resend' });
            }
          } else {
            reject(new Error(`Resend HTTP ${res.statusCode}: ${body}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Resend timeout')));
      req.write(payload);
      req.end();
    });
  }

  if (brevoApiKey) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        sender: { email: 'carelycorp237@gmail.com', name: 'Carely Support' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      });
      const req = https.request('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ sent: true, mode: 'brevo' });
          } else {
            reject(new Error(`Brevo HTTP ${res.statusCode}: ${body}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Brevo timeout')));
      req.write(payload);
      req.end();
    });
  }

  return null;
}

/**
 * Generate responsive, branded HTML email template for Carely Support.
 * Uses Carely forest green (#1E4030) theme, warm terracotta accents, and online hosted logo URL (NO ATTACHMENTS).
 */
function buildPasswordResetHtml({ firstName, email, resetToken, resetCode }) {
  const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
  const digits = String(resetCode || '123456').padStart(6, '0').split('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Account - Carely</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  </style>
</head>
<body style="background-color: #FAF8F5; margin: 0; padding: 32px 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; background-color: #FFFFFF; border-radius: 22px; overflow: hidden; box-shadow: 0 10px 28px rgba(30,64,48,0.08); border: 1px solid #EAE4DC;">
          
          <!-- Top Header: Carely Forest Green Theme (#1E4030) -->
          <tr>
            <td style="background-color: #1E4030; padding: 20px 26px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <!-- Left: Brand Logo & Name (where circled red) -->
                  <td align="left" valign="middle">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="middle" style="padding-right: 10px;">
                          <div style="width: 36px; height: 36px; background-color: #FFFFFF; border-radius: 10px; padding: 2px; box-sizing: border-box; display: inline-block; vertical-align: middle; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
                            <img src="${CARELY_LOGO_URL}" alt="Carely Logo" width="32" height="32" style="display: block; width: 32px; height: 32px; object-fit: contain; border: 0; outline: none;">
                          </div>
                        </td>
                        <td valign="middle">
                          <span style="color: #FFFFFF; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; vertical-align: middle;">Carely</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <!-- Right: Carely Support email -->
                  <td align="right" valign="middle">
                    <span style="color: #E2D9CF; font-size: 11px; font-weight: 500;">
                      Carely Support &bull; <a href="mailto:carelycorp237@gmail.com" style="color: #E29578; text-decoration: none; font-weight: 700;">carelycorp237@gmail.com</a>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Center Content Area -->
          <tr>
            <td style="padding: 38px 32px 30px; text-align: center;">
              
              <!-- Envelope Icon Badge -->
              <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto 18px;">
                <tr>
                  <td align="center" valign="middle" style="background-color: #EDF7F2; border: 1.5px solid #CDE7DB; border-radius: 18px; width: 58px; height: 58px; text-align: center;">
                    <div style="font-size: 26px; line-height: 58px; text-align: center;">
                      ✉️
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Main Title -->
              <h1 style="margin: 0 0 10px; font-size: 25px; font-weight: 800; color: #1C1A17; letter-spacing: -0.3px;">
                Verify Your Account
              </h1>

              <!-- Subtitle Description -->
              <p style="margin: 0 0 24px; font-size: 13.5px; line-height: 1.6; color: #554D45; max-width: 400px; margin-left: auto; margin-right: auto;">
                Use the code below to complete your verification on <strong style="color: #1E4030;">Carely</strong>. It expires in <strong>15 minutes</strong>.
              </p>

              <!-- Subtle Divider -->
              <div style="border-top: 1px solid #EAE4DC; margin: 0 0 24px;"></div>

              <!-- YOUR VERIFICATION CODE Header -->
              <p style="margin: 0 0 14px; font-size: 11px; font-weight: 800; color: #8A7E74; text-transform: uppercase; letter-spacing: 2px;">
                YOUR VERIFICATION CODE
              </p>

              <!-- 6 Distinct Rounded Digit Badges (Carely Green #1E4030 Theme) -->
              <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto 18px;">
                <tr>
                  ${digits
                    .map(
                      (d) => `
                    <td align="center" style="padding: 0 3.5px;">
                      <table border="0" cellpadding="0" cellspacing="0" width="45" height="54" style="background-color: #1E4030; border: 1px solid #2A5641; border-radius: 10px; text-align: center; width: 45px; height: 54px; box-shadow: 0 3px 8px rgba(30,64,48,0.25);">
                        <tr>
                          <td align="center" valign="middle" style="color: #FFFFFF; font-size: 25px; font-weight: 800; font-family: 'Courier New', Courier, monospace; text-align: center;">
                            ${d}
                          </td>
                        </tr>
                      </table>
                    </td>
                  `
                    )
                    .join('')}
                </tr>
              </table>

              <!-- Expiration Warning Alert -->
              <p style="margin: 18px 0 0; font-size: 12.5px; color: #64748B;">
                <span style="color: #DC2626; font-weight: 700;">⚠️ Expires in 15 minutes</span> &minus; Do not share this code with anyone.
              </p>

              <!-- Direct Reset Link Button (Carely Green #1E4030) -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0 0;">
                <tr>
                  <td align="center">
                    <a href="${resetLink}" target="_blank" style="display: inline-block; background-color: #1E4030; color: #FFFFFF; text-decoration: none; font-size: 13.5px; font-weight: 700; padding: 12px 32px; border-radius: 11px; box-shadow: 0 4px 12px rgba(30,64,48,0.25); letter-spacing: 0.2px;">
                      Reset Password Directly &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security Callout Box -->
              <div style="background-color: #FAF8F5; border: 1px solid #EAE4DC; border-radius: 12px; padding: 16px 18px; margin-top: 26px; text-align: left;">
                <p style="margin: 0; font-size: 12px; line-height: 1.55; color: #665E55;">
                  If you did not request this verification, please ignore this email. Your account security is important to us. Never share this code with anyone claiming to be from Carely Support.
                </p>
              </div>

              <!-- Ellipsis & Subtle Footer -->
              <div style="text-align: center; margin-top: 22px;">
                <span style="color: #C5BCBA; font-size: 16px; letter-spacing: 3px;">&bull;&bull;&bull;</span>
                <p style="margin: 8px 0 0; font-size: 11px; color: #8A7E74;">
                  &copy; 2026 Carely Cameroon &bull; Carely Support (<a href="mailto:carelycorp237@gmail.com" style="color: #1E4030; font-weight: 600; text-decoration: none;">carelycorp237@gmail.com</a>)
                </p>
              </div>

            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send password reset email from carelycorp237@gmail.com to the recipient.
 * STRICTLY NO EMAIL ATTACHMENTS - logo loads from public HTTPS URL.
 */
async function sendPasswordResetEmail({ to, firstName, resetToken, resetCode }) {
  const { transporter, config, hasCredentials } = await createTransporter();
  const html = buildPasswordResetHtml({ firstName, email: to, resetToken, resetCode });
  const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(to)}`;

  // Save generated HTML preview for inspection
  try {
    const previewFile = path.join(__dirname, '../../../../scratch/email_preview.html');
    fs.writeFileSync(previewFile, html, 'utf8');
  } catch (e) {
    // Non-fatal
  }

  const senderAddress = 'Carely Support <carelycorp237@gmail.com>';
  const mailOptions = {
    from: senderAddress,
    to: to, // The receiver is the email requesting forgot password
    subject: `Verify Your Account - Carely Verification Code: ${resetCode}`,
    text: `Verify Your Account

Use the code below to complete your verification on Carely. It expires in 15 minutes.

YOUR VERIFICATION CODE: ${resetCode}

⚠️ Expires in 15 minutes - Do not share this code with anyone.

Or click this link to reset directly:
${resetLink}

If you did not request this verification, please ignore this email.

Carely Support Team (carelycorp237@gmail.com)`,
    html,
    // ZERO attachments — logo is rendered via public CDN URL
  };

  // 1. If an HTTP provider is configured (e.g. Resend, Brevo), send via port 443 (never blocked by Render)
  try {
    const httpResult = await sendViaHttpProvider({
      to,
      subject: mailOptions.subject,
      html,
      text: mailOptions.text,
    });
    if (httpResult && httpResult.sent) {
      console.log(`📧 [Carely Support] Real email sent via ${httpResult.mode} to ${to}: ${httpResult.messageId || ''}`);
      return { sent: true, mode: httpResult.mode, messageId: httpResult.messageId, resetCode, resetLink };
    }
  } catch (httpErr) {
    console.warn(`⚠️ [Carely Support] HTTP email error: ${httpErr.message}. Trying SMTP...`);
  }

  // 2. If live SMTP credentials are configured, send real email via Gmail SMTP
  if (hasCredentials && transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`📧 [Carely Support] Real email sent without attachments from ${senderAddress} to ${to}: ${info.messageId}`);
      return { sent: true, mode: 'smtp', messageId: info.messageId, resetCode, resetLink };
    } catch (err) {
      console.error(`⚠️ [Carely Support] SMTP dispatch error: ${err.message}. Falling back to dev logger.`);
    }
  }

  // Structured dispatch logging
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧 [Carely Support Email Dispatch]`);
  console.log(`📤 From (Sender):   ${senderAddress}`);
  console.log(`📥 To (Receiver):   ${to}`);
  console.log(`🔑 Verification Code: [ ${String(resetCode).split('').join(' ')} ]`);
  console.log(`⏱️ Expiry:           15 minutes`);
  console.log(`🎨 Theme:            Carely Green (#1E4030)`);
  console.log(`🖼️ Logo:             Hosted HTTPS URL (No attachments)`);
  console.log(`🔗 Direct Link:      ${resetLink}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return { sent: true, mode: 'dev', resetCode, resetLink };
}

/**
 * Generate branded HTML email template for Two-Factor Authentication (2FA) login code.
 * Strict Carely palette (#1E4030, #E29578, #FAF8F5), online hosted logo URL, zero attachments.
 */
function buildTwoFactorAuthHtml({ firstName, email, code }) {
  const digits = String(code || '123456').padStart(6, '0').split('');
  const greetingName = firstName ? ` ${firstName}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Two-Factor Authentication Code - Carely</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  </style>
</head>
<body style="background-color: #FAF8F5; margin: 0; padding: 32px 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; background-color: #FFFFFF; border-radius: 22px; overflow: hidden; box-shadow: 0 10px 28px rgba(30,64,48,0.08); border: 1px solid #EAE4DC;">
          
          <!-- Top Header: Carely Forest Green Theme (#1E4030) -->
          <tr>
            <td style="background-color: #1E4030; padding: 20px 26px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <!-- Left: Brand Logo & Name -->
                  <td align="left" valign="middle">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="middle" style="padding-right: 10px;">
                          <div style="width: 36px; height: 36px; background-color: #FFFFFF; border-radius: 10px; padding: 2px; box-sizing: border-box; display: inline-block; vertical-align: middle; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
                            <img src="${CARELY_LOGO_URL}" alt="Carely Logo" width="32" height="32" style="display: block; width: 32px; height: 32px; object-fit: contain; border: 0; outline: none;">
                          </div>
                        </td>
                        <td valign="middle">
                          <span style="color: #FFFFFF; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; vertical-align: middle;">Carely</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <!-- Right: Carely Support email -->
                  <td align="right" valign="middle">
                    <span style="color: #E2D9CF; font-size: 11px; font-weight: 500;">
                      Carely Security &bull; <a href="mailto:carelycorp237@gmail.com" style="color: #E29578; text-decoration: none; font-weight: 700;">carelycorp237@gmail.com</a>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Center Content Area -->
          <tr>
            <td style="padding: 38px 32px 30px; text-align: center;">
              
              <!-- Security Shield Icon Badge -->
              <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto 18px;">
                <tr>
                  <td align="center" valign="middle" style="background-color: #EDF7F2; border: 1.5px solid #CDE7DB; border-radius: 18px; width: 58px; height: 58px; text-align: center;">
                    <div style="font-size: 26px; line-height: 58px; text-align: center;">
                      🛡️
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Main Title -->
              <h1 style="margin: 0 0 10px; font-size: 24px; font-weight: 800; color: #1C1A17; letter-spacing: -0.3px;">
                Two-Factor Verification Code
              </h1>

              <!-- Subtitle Description -->
              <p style="margin: 0 0 24px; font-size: 13.5px; line-height: 1.6; color: #554D45; max-width: 420px; margin-left: auto; margin-right: auto;">
                Hello${greetingName}, you are signing in to your <strong style="color: #1E4030;">Carely</strong> account. Please enter the 6-digit security code below to complete your login.
              </p>

              <!-- Subtle Divider -->
              <div style="border-top: 1px solid #EAE4DC; margin: 0 0 24px;"></div>

              <!-- YOUR 2FA SECURITY CODE Header -->
              <p style="margin: 0 0 14px; font-size: 11px; font-weight: 800; color: #8A7E74; text-transform: uppercase; letter-spacing: 2px;">
                YOUR 2FA SECURITY CODE
              </p>

              <!-- 6 Distinct Rounded Digit Badges (Carely Green #1E4030 Theme) -->
              <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto 18px;">
                <tr>
                  ${digits
                    .map(
                      (d) => `
                    <td align="center" style="padding: 0 3.5px;">
                      <table border="0" cellpadding="0" cellspacing="0" width="45" height="54" style="background-color: #1E4030; border: 1px solid #2A5641; border-radius: 10px; text-align: center; width: 45px; height: 54px; box-shadow: 0 3px 8px rgba(30,64,48,0.25);">
                        <tr>
                          <td align="center" valign="middle" style="color: #FFFFFF; font-size: 25px; font-weight: 800; font-family: 'Courier New', Courier, monospace; text-align: center;">
                            ${d}
                          </td>
                        </tr>
                      </table>
                    </td>
                  `
                    )
                    .join('')}
                </tr>
              </table>

              <!-- Expiration Warning Alert -->
              <p style="margin: 18px 0 0; font-size: 12.5px; color: #64748B;">
                <span style="color: #DC2626; font-weight: 700;">⚠️ Code expires in 15 minutes</span> &minus; Do not disclose this code to anyone.
              </p>

              <!-- Security Callout Box -->
              <div style="background-color: #FAF8F5; border: 1px solid #EAE4DC; border-radius: 12px; padding: 16px 18px; margin-top: 26px; text-align: left;">
                <p style="margin: 0; font-size: 12px; line-height: 1.55; color: #665E55;">
                  <strong>Notice:</strong> If you did not attempt to sign in to Carely, please change your password immediately or contact our security team at <a href="mailto:carelycorp237@gmail.com" style="color: #1E4030; font-weight: 700; text-decoration: none;">carelycorp237@gmail.com</a>.
                </p>
              </div>

              <!-- Ellipsis & Subtle Footer -->
              <div style="text-align: center; margin-top: 22px;">
                <span style="color: #C5BCBA; font-size: 16px; letter-spacing: 3px;">&bull;&bull;&bull;</span>
                <p style="margin: 8px 0 0; font-size: 11px; color: #8A7E74;">
                  &copy; 2026 Carely Cameroon &bull; Carely Support (<a href="mailto:carelycorp237@gmail.com" style="color: #1E4030; font-weight: 600; text-decoration: none;">carelycorp237@gmail.com</a>)
                </p>
              </div>

            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send Two-Factor Authentication (2FA) verification code email via Gmail SMTP.
 * Strictly NO email attachments.
 */
async function sendTwoFactorAuthEmail({ to, firstName, code }) {
  const { transporter, config, hasCredentials } = await createTransporter();
  const html = buildTwoFactorAuthHtml({ firstName, email: to, code });

  const senderAddress = 'Carely Support <carelycorp237@gmail.com>';
  const mailOptions = {
    from: senderAddress,
    to: to,
    subject: `Two-Factor Authentication Code: ${code} - Carely`,
    text: `Two-Factor Verification Code

Hello${firstName ? ' ' + firstName : ''},

You are signing in to your Carely account. Use the 6-digit code below to confirm your identity:

YOUR 2FA SECURITY CODE: ${code}

⚠️ Expires in 15 minutes - Do not share this code with anyone.

If you did not attempt to log in, please secure your password immediately.

Carely Support Team (carelycorp237@gmail.com)`,
    html,
  };

  // 1. Try HTTP provider first if configured
  try {
    const httpResult = await sendViaHttpProvider({
      to,
      subject: mailOptions.subject,
      html,
      text: mailOptions.text,
    });
    if (httpResult && httpResult.sent) {
      console.log(`🔐 [2FA Email] Real 2FA OTP sent via ${httpResult.mode} to ${to}: ${httpResult.messageId || ''}`);
      return { sent: true, mode: httpResult.mode, messageId: httpResult.messageId, code };
    }
  } catch (httpErr) {
    console.warn(`⚠️ [2FA Email] HTTP email error: ${httpErr.message}. Trying SMTP...`);
  }

  // 2. Try SMTP via Gmail
  if (hasCredentials && transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`🔐 [2FA Email] Real 2FA OTP sent from ${senderAddress} to ${to}: ${info.messageId}`);
      return { sent: true, mode: 'smtp', messageId: info.messageId, code };
    } catch (err) {
      console.error(`⚠️ [2FA Email] SMTP dispatch error: ${err.message}. Falling back to dev logger.`);
    }
  }

  // Structured dev fallback logging
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔐 [2FA OTP Dispatch (Dev)]`);
  console.log(`📤 From (Sender):   ${senderAddress}`);
  console.log(`📥 To (Receiver):   ${to}`);
  console.log(`🔑 2FA OTP Code:    [ ${String(code).split('').join(' ')} ]`);
  console.log(`⏱️ Expiry:           15 minutes`);
  console.log(`🎨 Theme:            Carely Green (#1E4030)`);
  console.log(`🖼️ Logo:             Hosted HTTPS URL (No attachments)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return { sent: true, mode: 'dev', code };
}

/**
 * Generate branded HTML email template for Referral Invitation inspired by Sweepsouth.
 * Features:
 * - Centered Carely logo at top (hosted CDN, no attachments)
 * - Headline: "Get 5 frs off your first Carely service."
 * - Sweepsouth-inspired body copy tailored to Carely (home nursing, babysitting, elderly care, housekeeping)
 * - Distinct voucher code display
 * - Pill-shaped "Book Now" green button linking directly to the login page with referral code
 * - Zero attachments, high deliverability
 */
function buildReferralInviteHtml({ referrerName, referralCode, loginUrl }) {
  const senderDisplayName = referrerName || 'A friend';
  const targetUrl = loginUrl || `${FRONTEND_URL}/login?ref=${encodeURIComponent(referralCode || 'CARELY')}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Get 5 frs off your first Carely service</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  </style>
</head>
<body style="background-color: #FAF8F5; margin: 0; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <!-- Main Email Container (Sweepsouth style) -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 540px; background-color: #FFFFFF; border-radius: 20px; overflow: hidden; box-shadow: 0 6px 24px rgba(30,64,48,0.06); border: 1px solid #EAE4DC;">
          
          <!-- Body Content Area -->
          <tr>
            <td style="padding: 44px 38px 36px; text-align: left;">
              
              <!-- Brand Logo Centered at Top -->
              <div style="text-align: center; margin-bottom: 32px;">
                <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;">
                  <tr>
                    <td valign="middle" style="padding-right: 10px;">
                      <div style="width: 42px; height: 42px; background-color: #1E4030; border-radius: 12px; padding: 4px; box-sizing: border-box; display: inline-block; vertical-align: middle; box-shadow: 0 2px 6px rgba(30,64,48,0.2);">
                        <img src="${CARELY_LOGO_URL}" alt="Carely Logo" width="34" height="34" style="display: block; width: 34px; height: 34px; object-fit: contain; border: 0; outline: none;">
                      </div>
                    </td>
                    <td valign="middle">
                      <span style="color: #1E4030; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Carely</span>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Main Headline -->
              <h1 style="margin: 0 0 24px; font-size: 23px; font-weight: 800; color: #1C1A17; line-height: 1.35; text-align: center; letter-spacing: -0.2px;">
                Get 5 frs off your first Carely service.
              </h1>

              <!-- Sweepsouth inspired Paragraph 1 -->
              <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #2D2824;">
                ${senderDisplayName} thought you might love Carely. We think so too.
              </p>

              <!-- Sweepsouth inspired Paragraph 2 -->
              <p style="margin: 0 0 16px; font-size: 14.5px; line-height: 1.65; color: #554D45;">
                From sorting out home nursing to getting trusted help with babysitting, elderly care, and housekeeping, a little help at home can go a long way. Carely connects you with verified and certified caregivers across Cameroon, all in one place.
              </p>

              <!-- Sweepsouth inspired Paragraph 3 -->
              <p style="margin: 0 0 24px; font-size: 14.5px; line-height: 1.65; color: #554D45;">
                Your friend thought you might love this, so they sent you a voucher to try it out. No strings attached, just an easy way to get started. Use the code below at checkout and see why households across Cameroon rely on Carely every day.
              </p>

              <!-- Voucher Code Callout Box -->
              <div style="background-color: #FAF8F5; border: 1.5px dashed #CDE7DB; border-radius: 12px; padding: 16px 20px; margin: 28px 0; text-align: center;">
                <span style="font-size: 13px; font-weight: 600; color: #554D45; display: block; margin-bottom: 6px;">Your exclusive Carely voucher code:</span>
                <span style="font-size: 22px; font-weight: 800; font-family: 'Courier New', Courier, monospace; letter-spacing: 2.5px; color: #1E4030; background-color: #EDF7F2; padding: 6px 16px; border-radius: 8px; display: inline-block; border: 1px solid #BEE3D0;">
                  ${referralCode}
                </span>
              </div>

              <!-- Pill-shaped "Book Now" Button linking to /login?ref=... -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 32px 0 16px;">
                <tr>
                  <td align="center">
                    <a href="${targetUrl}" target="_blank" style="display: inline-block; background-color: #0E6245; color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 700; padding: 15px 46px; border-radius: 50px; box-shadow: 0 4px 14px rgba(14,98,69,0.28); letter-spacing: 0.3px; text-transform: none;">
                      Book Now
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Subtle Divider -->
              <div style="border-top: 1px solid #F0ECE6; margin: 34px 0 20px;"></div>

              <!-- Footer -->
              <div style="text-align: center;">
                <p style="margin: 0; font-size: 11.5px; color: #8A7E74; line-height: 1.55;">
                  &copy; 2026 Carely Cameroon &bull; Carely Support (<a href="mailto:carelycorp237@gmail.com" style="color: #1E4030; font-weight: 600; text-decoration: none;">carelycorp237@gmail.com</a>)<br>
                  Cameroon's Trusted Healthcare & Home Caregiver Platform
                </p>
              </div>

            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send Referral Invitation email to recipient from Carely Support (carelycorp237@gmail.com) via Gmail SMTP.
 * Strictly zero attachments.
 */
async function sendReferralInviteEmail({ to, referrerName, referralCode, loginUrl }) {
  const { transporter, config, hasCredentials } = await createTransporter();
  const targetLoginUrl = loginUrl || `${FRONTEND_URL}/login?ref=${encodeURIComponent(referralCode || 'CARELY')}`;
  const html = buildReferralInviteHtml({ referrerName, referralCode, loginUrl: targetLoginUrl });

  const senderAddress = 'Carely Support <carelycorp237@gmail.com>';
  const mailOptions = {
    from: senderAddress,
    to: to,
    subject: `Get 5 frs off your first Carely service — from ${referrerName || 'a friend'}`,
    text: `Get 5 frs off your first Carely service.

${referrerName || 'A friend'} thought you might love Carely. We think so too.

From sorting out home nursing to getting trusted help with babysitting, elderly care, and housekeeping, a little help at home can go a long way. Carely connects you with verified and certified caregivers across Cameroon, all in one place.

Your friend thought you might love this, so they sent you a voucher to try it out. No strings attached, just an easy way to get started. Use the code below at checkout and see why households across Cameroon rely on Carely every day.

Your exclusive Carely voucher code: ${referralCode}

Book Now: ${targetLoginUrl}

Carely Support Team (carelycorp237@gmail.com)`,
    html,
  };

  // 1. Try HTTP provider first if configured
  try {
    const httpResult = await sendViaHttpProvider({
      to,
      subject: mailOptions.subject,
      html,
      text: mailOptions.text,
    });
    if (httpResult && httpResult.sent) {
      console.log(`🎁 [Referral Invite Email] Dispatched via ${httpResult.mode} to ${to}: ${httpResult.messageId || ''}`);
      return { sent: true, mode: httpResult.mode, messageId: httpResult.messageId };
    }
  } catch (httpErr) {
    console.warn(`⚠️ [Referral Invite Email] HTTP email error: ${httpErr.message}. Trying SMTP...`);
  }

  // 2. Try SMTP via Gmail
  if (hasCredentials && transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`🎁 [Referral Invite Email] Dispatched to ${to}: ${info.messageId}`);
      return { sent: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.error(`⚠️ [Referral Invite Email] SMTP error: ${err.message}. Falling back to dev logger.`);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🎁 [Referral Invite Email (Dev)]`);
  console.log(`📤 From:      ${senderAddress}`);
  console.log(`📥 To:        ${to}`);
  console.log(`👤 Referrer:  ${referrerName}`);
  console.log(`🏷️ Code:      ${referralCode}`);
  console.log(`🔗 Link:      ${targetLoginUrl}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return { sent: true, mode: 'dev' };
}

module.exports = {
  getSmtpConfig,
  createTransporter,
  sendPasswordResetEmail,
  buildPasswordResetHtml,
  sendTwoFactorAuthEmail,
  buildTwoFactorAuthHtml,
  buildReferralInviteHtml,
  sendReferralInviteEmail,
};


