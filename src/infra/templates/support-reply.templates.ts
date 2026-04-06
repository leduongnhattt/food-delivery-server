import { escapeHtml } from './html.utils';

export type SupportReplyEmailParams = {
  appName: string;
  username: string;
  ticketId: string;
  ticketSubject: string;
  ticketCategory?: string;
  ticketStatus?: string;
  replyBody: string;
};

/**
 * HTML body for "admin replied to your support ticket" notification.
 */
export function buildSupportReplyEmailHtml(
  params: SupportReplyEmailParams,
): string {
  const {
    appName,
    username,
    ticketId,
    ticketSubject,
    ticketCategory,
    ticketStatus,
    replyBody,
  } = params;
  const safeBody = escapeHtml(replyBody).replace(/\r\n|\n|\r/g, '<br/>');
  const safeTicketId = escapeHtml(ticketId);
  const safeCategory = ticketCategory ? escapeHtml(ticketCategory) : '';
  const safeStatus = ticketStatus ? escapeHtml(ticketStatus) : '';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Support reply</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6f7fb;">
    <!-- Preheader (hidden) -->
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
      New reply on your support ticket: ${escapeHtml(ticketSubject)}
    </div>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;background-color:#f6f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="width:600px;max-width:600px;border-collapse:separate;">
            <!-- Brand header -->
            <tr>
              <td style="padding:0 0 14px 0;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="left" style="font-family:Arial,Helvetica,sans-serif;">
                      <span style="display:inline-block;font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#111827;">
                        ${escapeHtml(appName)}
                      </span>
                    </td>
                    <td align="right" style="font-family:Arial,Helvetica,sans-serif;">
                      <span style="display:inline-block;font-size:12px;color:#6b7280;">
                        Support update
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(17,24,39,0.08);">
                <!-- Accent header -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding:18px 20px;background:linear-gradient(135deg,#0ea5e9,#22c55e);">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
                            <div style="font-size:14px;opacity:0.95;">New reply received</div>
                            <div style="margin-top:4px;font-size:18px;font-weight:800;letter-spacing:-0.02em;">
                              ${escapeHtml(ticketSubject)}
                            </div>
                          </td>
                          <td align="right" style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
                            <span style="display:inline-block;padding:6px 10px;border-radius:999px;background-color:rgba(255,255,255,0.18);font-size:12px;font-weight:700;">
                              Action required
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding:20px 20px 8px 20px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                      <div style="font-size:14px;line-height:1.5;color:#374151;">
                        Hi <strong style="color:#111827;">${escapeHtml(username)}</strong>,
                        <br />
                        Our team has replied to your support ticket. You can read the response below.
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 20px 6px 20px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;">
                        <tr>
                          <td style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:12px;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                            <div style="font-size:12px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">
                              Ticket details
                            </div>
                            <div style="margin-top:8px;font-size:13px;line-height:1.6;color:#111827;">
                              <div><strong>Ticket ID:</strong> <span style="word-break:break-all;">${safeTicketId}</span></div>
                              ${safeCategory ? `<div><strong>Category:</strong> ${safeCategory}</div>` : ``}
                              ${safeStatus ? `<div><strong>Status:</strong> ${safeStatus}</div>` : ``}
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:12px 20px 6px 20px;">
                      <div style="border:1px solid #e5e7eb;border-radius:12px;background-color:#f8fafc;padding:14px 14px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                        <div style="font-size:12px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">
                          Reply
                        </div>
                        <div style="margin-top:10px;font-size:14px;line-height:1.6;color:#111827;">
                          ${safeBody}
                        </div>
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:10px 20px 22px 20px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
                      <div style="font-size:12px;line-height:1.5;">
                        To view your ticket, sign in to ${escapeHtml(appName)} and open the Support page.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:14px 4px 0 4px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">
                <div style="font-size:12px;line-height:1.5;">
                  You’re receiving this email because you have an open support ticket on ${escapeHtml(appName)}.
                  <br />
                  This is an automated message — please do not reply.
                </div>
                <div style="margin-top:10px;font-size:12px;color:#9ca3af;">
                  © ${new Date().getFullYear()} ${escapeHtml(appName)}. All rights reserved.
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

export function buildSupportReplyEmailText(params: SupportReplyEmailParams): string {
  const {
    appName,
    username,
    ticketId,
    ticketSubject,
    ticketCategory,
    ticketStatus,
    replyBody,
  } = params;
  return [
    `${appName}`,
    ``,
    `Hi ${username},`,
    ``,
    `Support reply: ${ticketSubject}`,
    `Ticket ID: ${ticketId}`,
    ...(ticketCategory ? [`Category: ${ticketCategory}`] : []),
    ...(ticketStatus ? [`Status: ${ticketStatus}`] : []),
    ``,
    replyBody,
    ``,
    `Sign in to ${appName} and open the Support page to view your ticket.`,
  ].join('\n');
}
