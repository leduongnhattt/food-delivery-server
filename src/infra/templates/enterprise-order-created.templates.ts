import { escapeHtml } from './html.utils';

export function buildEnterpriseNewOrderEmailHtml(input: {
  appName: string;
  enterpriseName?: string | null;
  orderId: string;
  customerName?: string | null;
  totalAmount?: number | null;
  orderUrl?: string | null;
}) {
  const app = escapeHtml(input.appName || 'HanalaFood');
  const enterprise = escapeHtml(input.enterpriseName || 'Enterprise');
  const orderId = escapeHtml(input.orderId);
  const customer = escapeHtml(input.customerName || 'a customer');
  const total =
    typeof input.totalAmount === 'number' && Number.isFinite(input.totalAmount)
      ? `$${input.totalAmount.toFixed(2)}`
      : null;
  const url = input.orderUrl ? String(input.orderUrl) : null;

  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">
    <h2 style="margin: 0 0 12px;">${app} — New order received</h2>
    <p style="margin: 0 0 8px;">Hi ${enterprise},</p>
    <p style="margin: 0 0 12px;">
      You have a new order <strong>#${orderId}</strong> from <strong>${customer}</strong>${total ? ` (total: <strong>${escapeHtml(total)}</strong>)` : ''}.
    </p>
    ${
      url
        ? `<p style="margin: 0 0 12px;"><a href="${escapeHtml(url)}" style="color: #2563eb; text-decoration: none;">Open order details</a></p>`
        : ''
    }
    <p style="margin: 18px 0 0; font-size: 12px; color: #64748b;">
      This is an automated message from ${app}.
    </p>
  </div>
  `.trim();
}

export function buildEnterpriseNewOrderEmailText(input: {
  appName: string;
  enterpriseName?: string | null;
  orderId: string;
  customerName?: string | null;
  totalAmount?: number | null;
  orderUrl?: string | null;
}) {
  const app = input.appName || 'HanalaFood';
  const enterprise = input.enterpriseName || 'Enterprise';
  const customer = input.customerName || 'a customer';
  const total =
    typeof input.totalAmount === 'number' && Number.isFinite(input.totalAmount)
      ? `$${input.totalAmount.toFixed(2)}`
      : '';
  const totalSuffix = total ? ` (total: ${total})` : '';
  const urlSuffix = input.orderUrl ? `\nOpen: ${input.orderUrl}` : '';
  return `${app} — New order received\n\nHi ${enterprise},\n\nYou have a new order #${input.orderId} from ${customer}${totalSuffix}.${urlSuffix}\n`;
}

