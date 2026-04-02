import { PaymentMethod } from '@prisma/client';

export const PAYMENT_METHOD = {
  Cash: PaymentMethod.Cash,
  CreditCard: PaymentMethod.CreditCard,
  MoMo: PaymentMethod.MoMo,
  VNPay: PaymentMethod.VNPay,
  BankTransfer: PaymentMethod.BankTransfer,
} as const;

