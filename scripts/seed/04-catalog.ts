import type { PrismaClient } from '@prisma/client';

async function getAdminId(prisma: PrismaClient): Promise<string> {
  const admin = await prisma.admin.findFirst({ select: { AdminID: true }, orderBy: { RoleLevel: 'desc' } });
  if (!admin) throw new Error('Missing admin');
  return admin.AdminID;
}

async function getEnterpriseId(prisma: PrismaClient): Promise<string> {
  const enterprise = await prisma.enterprise.findFirst({ select: { EnterpriseID: true }, orderBy: { CreatedAt: 'asc' } });
  if (!enterprise) throw new Error('Missing enterprise');
  return enterprise.EnterpriseID;
}

export async function seed04Catalog(prisma: PrismaClient) {
  const [adminId, enterpriseId] = await Promise.all([getAdminId(prisma), getEnterpriseId(prisma)]);

  const foodCategory = await prisma.foodCategory.upsert({
    where: { CategoryName: 'Pizza' },
    create: {
      CategoryName: 'Pizza',
      Description: 'Pizza items',
      AdminID: adminId,
    },
    update: {
      Description: 'Pizza items',
      AdminID: adminId,
    },
    select: { CategoryID: true },
  });

  const food = await prisma.food.upsert({
    where: {
      // No unique constraint on DishName; use FoodID via findFirst+update/create approach.
      FoodID: '00000000-0000-0000-0000-00000000food1',
    },
    create: {
      FoodID: '00000000-0000-0000-0000-00000000food1',
      DishName: 'Pepperoni Pizza',
      Price: 6,
      Stock: 100,
      Description: 'Seed item: Pepperoni Pizza',
      ImageURL: null,
      FoodCategoryID: foodCategory.CategoryID,
      EnterpriseID: enterpriseId,
      IsAvailable: true,
    },
    update: {
      DishName: 'Pepperoni Pizza',
      Price: 6,
      Stock: 100,
      Description: 'Seed item: Pepperoni Pizza',
      FoodCategoryID: foodCategory.CategoryID,
      EnterpriseID: enterpriseId,
      IsAvailable: true,
    },
    select: { FoodID: true },
  });

  const menu = await prisma.menu.upsert({
    where: {
      MenuID: '00000000-0000-0000-0000-00000000menu1',
    },
    create: {
      MenuID: '00000000-0000-0000-0000-00000000menu1',
      EnterpriseID: enterpriseId,
      MenuName: 'Main Menu',
      Description: 'Seed menu',
    },
    update: {
      EnterpriseID: enterpriseId,
      MenuName: 'Main Menu',
      Description: 'Seed menu',
    },
    select: { MenuID: true },
  });

  await prisma.menuFood.upsert({
    where: { FoodID_MenuID: { FoodID: food.FoodID, MenuID: menu.MenuID } },
    create: { FoodID: food.FoodID, MenuID: menu.MenuID },
    update: {},
  });
}

