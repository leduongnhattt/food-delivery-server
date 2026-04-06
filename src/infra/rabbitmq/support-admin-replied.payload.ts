/**
 * JSON payload for support.admin.replied (queue message).
 */
export type SupportAdminRepliedPayload = {
  ticketId: string;
  ticketCategory?: string;
  ticketStatus?: string;
  requesterEmail: string;
  requesterUsername: string;
  ticketSubject: string;
  replyBody: string;
  requesterRole: string;
};
