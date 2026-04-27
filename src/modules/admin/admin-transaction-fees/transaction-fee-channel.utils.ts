import { BadRequestException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';

/** UI / API filter token (query `paymentChannel`). */
export type TransactionFeeChannelFilterToken =
  | 'Cash'
  | 'CreditCard'
  | 'MoMo'
  | 'VNPay'
  | 'BankTransfer'
  | 'Stripe';

const UI_TO_DB: Record<
  string,
  { method: PaymentMethod; providerCode: string | null }
> = {
  Cash: { method: PaymentMethod.Cash, providerCode: null },
  MoMo: { method: PaymentMethod.MoMo, providerCode: null },
  VNPay: { method: PaymentMethod.VNPay, providerCode: null },
  'Credit Card': { method: PaymentMethod.CreditCard, providerCode: null },
  CreditCard: { method: PaymentMethod.CreditCard, providerCode: null },
  'Bank Transfer': { method: PaymentMethod.BankTransfer, providerCode: null },
  BankTransfer: { method: PaymentMethod.BankTransfer, providerCode: null },
  Stripe: { method: PaymentMethod.CreditCard, providerCode: 'stripe' },
};

export function parseUiPaymentChannelToDb(input: string): {
  method: PaymentMethod;
  providerCode: string | null;
} {
  const key = (input || '').trim();
  const mapped = UI_TO_DB[key];
  if (!mapped) {
    throw new BadRequestException(`Unsupported payment channel: ${key}`);
  }
  return mapped;
}

export function paymentChannelLabel(
  method: PaymentMethod,
  providerCode: string | null,
): string {
  const p = (providerCode || '').trim().toLowerCase();
  if (method === PaymentMethod.CreditCard && p === 'stripe') {
    return 'Stripe';
  }
  switch (method) {
    case PaymentMethod.CreditCard:
      return 'Credit Card';
    case PaymentMethod.BankTransfer:
      return 'Bank Transfer';
    case PaymentMethod.Cash:
      return 'Cash';
    case PaymentMethod.MoMo:
      return 'MoMo';
    case PaymentMethod.VNPay:
      return 'VNPay';
    default:
      return String(method);
  }
}

export function parseChannelFilterToken(
  raw: string | undefined | null,
): TransactionFeeChannelFilterToken | null {
  const s = (raw || '').trim();
  if (!s || s.toLowerCase() === 'all') return null;
  const allowed = new Set<string>([
    'Cash',
    'CreditCard',
    'MoMo',
    'VNPay',
    'BankTransfer',
    'Stripe',
  ]);
  if (!allowed.has(s)) {
    throw new BadRequestException(`Invalid paymentChannel: ${s}`);
  }
  return s as TransactionFeeChannelFilterToken;
}
