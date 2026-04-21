import { ConflictException, NotFoundException } from '@nestjs/common';
import { EnterpriseIncomeService } from '@modules/enterprise/income/enterprise-income.service';
import type { PrismaService } from '@infra/prisma/prisma.service';

type PrismaLike = {
  enterprise: { findFirst: jest.Mock };
  settlement: { findFirst: jest.Mock };
  enterprisePayoutSettings: { findUnique: jest.Mock };
  enterprisePayoutDestination: { findMany: jest.Mock; findFirst: jest.Mock };
  enterprisePayoutRequest: { findFirst: jest.Mock; create: jest.Mock };
  enterpriseLedgerEntry: { create: jest.Mock };
  $transaction: <T>(fn: (tx: PrismaLike) => Promise<T>) => Promise<T>;
};

function createPrismaMock(overrides: Partial<PrismaLike> = {}): PrismaLike {
  const base: PrismaLike = {
    enterprise: { findFirst: jest.fn() },
    settlement: { findFirst: jest.fn() },
    enterprisePayoutSettings: { findUnique: jest.fn() },
    enterprisePayoutDestination: { findMany: jest.fn(), findFirst: jest.fn() },
    enterprisePayoutRequest: { findFirst: jest.fn(), create: jest.fn() },
    enterpriseLedgerEntry: { create: jest.fn() },
    $transaction: <T>(fn: (tx: PrismaLike) => Promise<T>) =>
      fn(createPrismaMock(overrides)),
  };
  return { ...base, ...overrides };
}

describe('EnterpriseIncomeService', () => {
  test('getSummary returns zero when no settlement', async () => {
    const prisma = createPrismaMock({
      enterprise: { findFirst: jest.fn().mockResolvedValue({ EnterpriseID: 'e1' }) },
      settlement: { findFirst: jest.fn().mockResolvedValue(null) },
      enterprisePayoutSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      enterprisePayoutDestination: { findMany: jest.fn().mockResolvedValue([]) },
      enterprisePayoutRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const svc = new EnterpriseIncomeService(prisma as unknown as PrismaService);
    const res = await svc.getSummary('acc1');
    expect(res.success).toBe(true);
    expect(res.balance).toBe(0);
    expect(res.canWithdraw).toBe(false);
  });

  test('getSummary reserves balance to 0 when active payout request exists', async () => {
    const prisma = createPrismaMock({
      enterprise: { findFirst: jest.fn().mockResolvedValue({ EnterpriseID: 'e1' }) },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          SettlementID: 's1',
          NetPayout: 5.7,
          PaidAt: null,
          Status: 'Pending',
          PeriodStart: new Date(),
          PeriodEnd: new Date(),
        }),
      },
      enterprisePayoutSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      enterprisePayoutDestination: {
        findMany: jest.fn().mockResolvedValue([
          {
            PayoutDestinationID: 'd1',
            Kind: 'BankAccount',
            BankName: 'MBBank',
            AccountNumber: '0818',
            WalletRef: null,
            WalletDisplayName: null,
            IsActive: true,
            IsDefault: true,
          },
        ]),
      },
      enterprisePayoutRequest: { findFirst: jest.fn().mockResolvedValue({ PayoutRequestID: 'pr1' }) },
    });
    const svc = new EnterpriseIncomeService(prisma as unknown as PrismaService);
    const res = await svc.getSummary('acc1');
    expect(res.balance).toBe(0);
    expect(res.canWithdraw).toBe(false);
  });

  test('createWithdrawRequest rejects when settlement is already paid', async () => {
    const prisma = createPrismaMock({
      enterprise: { findFirst: jest.fn().mockResolvedValue({ EnterpriseID: 'e1' }) },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          SettlementID: 's1',
          NetPayout: 100,
          PaidAt: new Date(),
        }),
      },
    });
    const svc = new EnterpriseIncomeService(prisma as unknown as PrismaService);
    await expect(svc.createWithdrawRequest('acc1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  test('createWithdrawRequest rejects when no settlement exists', async () => {
    const prisma = createPrismaMock({
      enterprise: { findFirst: jest.fn().mockResolvedValue({ EnterpriseID: 'e1' }) },
      settlement: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const svc = new EnterpriseIncomeService(prisma as unknown as PrismaService);
    await expect(svc.createWithdrawRequest('acc1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  test('createWithdrawRequest rejects when duplicate active request exists', async () => {
    const prisma = createPrismaMock({
      enterprise: { findFirst: jest.fn().mockResolvedValue({ EnterpriseID: 'e1' }) },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          SettlementID: 's1',
          NetPayout: 100,
          PaidAt: null,
        }),
      },
      enterprisePayoutDestination: {
        findFirst: jest.fn().mockResolvedValue({
          PayoutDestinationID: 'd1',
          IsActive: true,
        }),
      },
      enterprisePayoutRequest: {
        findFirst: jest.fn().mockResolvedValue({ PayoutRequestID: 'r1' }),
        create: jest.fn(),
      },
    });
    // Ensure $transaction uses tx with the same behavior
    prisma.$transaction = <T>(fn: (tx: PrismaLike) => Promise<T>) =>
      fn({
        ...prisma,
        enterprisePayoutRequest: prisma.enterprisePayoutRequest,
        enterpriseLedgerEntry: prisma.enterpriseLedgerEntry,
      });
    const svc = new EnterpriseIncomeService(prisma as unknown as PrismaService);
    await expect(
      svc.createWithdrawRequest('acc1', { payoutDestinationId: 'd1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

