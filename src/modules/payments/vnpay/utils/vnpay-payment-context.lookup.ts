import type { PrismaService } from '@infra/prisma/prisma.service';
import type { CreateCheckoutSessionRequestDto } from '@modules/payments/dto';

const DEFAULT_ACCOUNT_CURRENCY = 'USD';
const DEFAULT_ENTERPRISE_DISPLAY_NAME = 'Hanala Food';

export async function loadAccountCurrencyCode(
  prisma: PrismaService,
  accountId: string,
): Promise<string> {
  const account = await prisma.account.findUnique({
    where: { AccountID: accountId },
    select: { Currency: true },
  });
  return (account?.Currency?.trim() || DEFAULT_ACCOUNT_CURRENCY);
}

export async function loadEnterpriseDisplayNameFromFirstCartItem(
  prisma: PrismaService,
  checkout: CreateCheckoutSessionRequestDto,
  fallbackName: string = DEFAULT_ENTERPRISE_DISPLAY_NAME,
): Promise<string> {
  const firstFoodId = checkout.cartItems?.[0]?.menuItem?.id;
  if (!firstFoodId) return fallbackName;

  const food = await prisma.food.findUnique({
    where: { FoodID: firstFoodId },
    select: { enterprise: { select: { EnterpriseName: true } } },
  });
  return food?.enterprise?.EnterpriseName || fallbackName;
}
