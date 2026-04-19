import type { PaymentMethod, PrismaClient } from '@prisma/client';

async function getAccountIdByEmail(prisma: PrismaClient, email: string): Promise<string> {
  const account = await prisma.account.findUnique({ where: { Email: email }, select: { AccountID: true } });
  if (!account) throw new Error(`Missing account: ${email}`);
  return account.AccountID;
}

export async function seed03Profiles(prisma: PrismaClient) {
  const [adminAccountId, customerAccountId, enterpriseAccountId] = await Promise.all([
    getAccountIdByEmail(prisma, 'admin@example.com'),
    getAccountIdByEmail(prisma, 'customer@example.com'),
    getAccountIdByEmail(prisma, 'enterprise@example.com'),
  ]);

  await prisma.admin.upsert({
    where: { AccountID: adminAccountId },
    create: {
      AccountID: adminAccountId,
      CanManageSystem: true,
      CanViewReport: true,
      RoleLevel: 10,
    },
    update: {
      CanManageSystem: true,
      CanViewReport: true,
      RoleLevel: 10,
    },
  });

  await prisma.customer.upsert({
    where: { AccountID: customerAccountId },
    create: {
      AccountID: customerAccountId,
      FullName: 'Test Customer',
      PhoneNumber: '0900000001',
      Address: '1 Test Street, District 1',
      PreferredPaymentMethod: 'Cash' as PaymentMethod,
    },
    update: {
      FullName: 'Test Customer',
      Address: '1 Test Street, District 1',
      PreferredPaymentMethod: 'Cash' as PaymentMethod,
    },
  });

  await prisma.enterprise.upsert({
    where: { AccountID: enterpriseAccountId },
    create: {
      AccountID: enterpriseAccountId,
      EnterpriseName: 'Test Pizza Shop',
      Address: '2 Test Street, District 1',
      PhoneNumber: '0900000002',
      OpenHours: '08:00',
      CloseHours: '22:00',
      IsActive: true,
      CommissionRate: 5,
    },
    update: {
      EnterpriseName: 'Test Pizza Shop',
      Address: '2 Test Street, District 1',
      OpenHours: '08:00',
      CloseHours: '22:00',
      IsActive: true,
      CommissionRate: 5,
    },
  });
}

