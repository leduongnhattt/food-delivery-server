import type { PrismaClient } from '@prisma/client';

export async function seed01Roles(prisma: PrismaClient) {
  const roles = [
    { RoleName: 'Admin', Description: 'System admin' },
    { RoleName: 'Customer', Description: 'Customer user' },
    { RoleName: 'Enterprise', Description: 'Restaurant/enterprise user' },
  ] as const;

  for (const r of roles) {
    await prisma.role.upsert({
      where: { RoleName: r.RoleName },
      create: {
        RoleName: r.RoleName,
        Description: r.Description,
        IsActive: true,
      },
      update: {
        Description: r.Description,
        IsActive: true,
      },
    });
  }
}

