import { escapeHtml } from './html.utils';

function brand() {
  const appName = process.env.APP_NAME || 'HanalaFood';
  const supportEmail = process.env.SMTP_USER || 'support@example.com';
  const baseImageUrl =
    (process.env.BASE_IMAGE_URL || '').replace(/\/$/, '') ||
    'https://raw.githubusercontent.com/leduongnhattt/food-delivery-static/master/images';
  const logoUrl = `${baseImageUrl}/logo_48.png`;
  return { appName, supportEmail, logoUrl };
}

/**
 * Password reset email (verification code).
 * Ported from `food-delivery-app/src/templates/email-templates.ts` to server.
 */
export function generatePasswordResetEmail(
  resetCode: string,
  username: string,
): string {
  const { appName, supportEmail, logoUrl } = brand();
  const safeUser = escapeHtml(username || 'there');
  const safeCode = escapeHtml(String(resetCode || '').trim());
  const safeApp = escapeHtml(appName);
  const safeSupport = escapeHtml(supportEmail);
  const safeLogo = escapeHtml(logoUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Reset your password - ${safeApp}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f0f2f5;padding:20px 0;">
    <tr>
      <td align="center" style="padding:20px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;border-collapse:separate;overflow:hidden;border-radius:12px;background:#ffffff;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:0;background:linear-gradient(135deg,#f59e0b 0%,#d97706 50%,#b45309 100%);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="padding:34px 24px 28px 24px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding-right:14px;">
                          <img src="${safeLogo}" width="56" height="56" alt="${safeApp}" style="display:block;border-radius:16px;background:#ffffff;border:2px solid rgba(255,255,255,0.25);" />
                        </td>
                        <td style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
                          <div style="font-size:36px;font-weight:800;letter-spacing:-0.02em;line-height:1;">${safeApp}</div>
                          <div style="margin-top:12px;font-size:14px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.95;">Reset your password</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 10px 28px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
              <div style="font-size:16px;font-weight:700;margin-bottom:10px;">Hi ${safeUser},</div>
              <div style="font-size:14px;line-height:1.6;color:#4b5563;">
                We received a request to reset your password for your ${safeApp} account.
                Use the verification code below to complete the process.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 28px 0 28px;">
              <div style="border:1px solid #e5e7eb;border-radius:12px;background:#f8f9fa;padding:22px 18px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Your verification code</div>
                <div style="margin-top:14px;font-size:34px;font-weight:800;color:#f59e0b;letter-spacing:10px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
                  ${safeCode}
                </div>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 28px 6px 28px;font-family:Arial,Helvetica,sans-serif;">
              <div style="border:1px solid #f59e0b;border-left:4px solid #f59e0b;border-radius:12px;background:#fff7ed;padding:16px 16px;color:#92400e;">
                <div style="font-size:13px;font-weight:800;margin-bottom:8px;">Security notice</div>
                <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.6;">
                  <li>This code will expire in 60 seconds</li>
                  <li>If you didn't request this reset, please ignore this email</li>
                  <li>Never share this code with anyone</li>
                </ul>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 26px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
              <div style="background:#f3f4f6;border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:13px;font-weight:800;color:#374151;">Need help?</div>
                <div style="margin-top:6px;font-size:12px;">Contact our support team</div>
                <div style="margin-top:8px;font-size:12px;font-weight:800;color:#111827;">${safeSupport}</div>
              </div>
              <div style="margin-top:14px;font-size:11px;color:#9ca3af;text-align:center;">
                © ${new Date().getFullYear()} ${safeApp}. All rights reserved.
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
 * Password reset success email.
 * Ported from `food-delivery-app/src/templates/email-templates.ts` to server.
 */
export function generatePasswordResetSuccessEmail(username: string): string {
  const { appName, supportEmail, logoUrl } = brand();
  const safeUser = escapeHtml(username || 'there');
  const safeApp = escapeHtml(appName);
  const safeSupport = escapeHtml(supportEmail);
  const safeLogo = escapeHtml(logoUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Password updated successfully - ${safeApp}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:#f0f2f5;padding:20px 0;">
    <tr>
      <td align="center" style="padding:20px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;border-collapse:separate;overflow:hidden;border-radius:12px;background:#ffffff;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:0;background:linear-gradient(135deg,#f59e0b 0%,#d97706 50%,#b45309 100%);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="padding:34px 24px 28px 24px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding-right:14px;">
                          <img src="${safeLogo}" width="56" height="56" alt="${safeApp}" style="display:block;border-radius:16px;background:#ffffff;border:2px solid rgba(255,255,255,0.25);" />
                        </td>
                        <td style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
                          <div style="font-size:36px;font-weight:800;letter-spacing:-0.02em;line-height:1;">${safeApp}</div>
                          <div style="margin-top:12px;font-size:14px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.95;">Password updated</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
              <div style="font-size:16px;font-weight:700;margin-bottom:10px;">Hi ${safeUser},</div>
              <div style="font-size:14px;line-height:1.6;color:#4b5563;">
                Your password has been updated successfully. You can now sign in with your new password.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:10px 28px 0 28px;">
              <div style="border:1px solid #10b981;border-radius:12px;background:#ecfdf5;padding:18px 16px;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#065f46;">
                <div style="font-size:34px;line-height:1;">✅</div>
                <div style="margin-top:10px;font-size:18px;font-weight:800;">Password reset successful</div>
                <div style="margin-top:6px;font-size:13px;">If you did not do this, please contact support immediately.</div>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 26px 28px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
              <div style="background:#f3f4f6;border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:13px;font-weight:800;color:#374151;">Need help?</div>
                <div style="margin-top:6px;font-size:12px;">Contact our support team</div>
                <div style="margin-top:8px;font-size:12px;font-weight:800;color:#111827;">${safeSupport}</div>
              </div>
              <div style="margin-top:14px;font-size:11px;color:#9ca3af;text-align:center;">
                © ${new Date().getFullYear()} ${safeApp}. All rights reserved.
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

