import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function getRoleIdByName(prisma: PrismaClient, roleName: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { RoleName: roleName }, select: { RoleID: true } });
  if (!role) throw new Error(`Missing role: ${roleName}`);
  return role.RoleID;
}

export async function seed02Accounts(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const [adminRoleId, customerRoleId, enterpriseRoleId] = await Promise.all([
    getRoleIdByName(prisma, 'Admin'),
    getRoleIdByName(prisma, 'Customer'),
    getRoleIdByName(prisma, 'Enterprise'),
  ]);

  await prisma.account.upsert({
    where: { Email: 'admin@example.com' },
    create: {
      Email: 'admin@example.com',
      Username: 'admin',
      PasswordHash: passwordHash,
      RoleID: adminRoleId,
      EmailVerified: true,
    },
    update: {
      Username: 'admin',
      RoleID: adminRoleId,
      EmailVerified: true,
      PasswordHash: passwordHash,
    },
  });

  await prisma.account.upsert({
    where: { Email: 'customer@example.com' },
    create: {
      Email: 'customer@example.com',
      Username: 'customer',
      PasswordHash: passwordHash,
      RoleID: customerRoleId,
      EmailVerified: true,
    },
    update: {
      Username: 'customer',
      RoleID: customerRoleId,
      EmailVerified: true,
      PasswordHash: passwordHash,
    },
  });

  await prisma.account.upsert({
    where: { Email: 'enterprise@example.com' },
    create: {
      Email: 'enterprise@example.com',
      Username: 'enterprise',
      PasswordHash: passwordHash,
      RoleID: enterpriseRoleId,
      EmailVerified: true,
    },
    update: {
      Username: 'enterprise',
      RoleID: enterpriseRoleId,
      EmailVerified: true,
      PasswordHash: passwordHash,
    },
  });
}

