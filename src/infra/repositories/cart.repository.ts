import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import {
  cartByIdKey,
  cartIdByGuestKey,
  cartIdByUserKey,
  cartItemsKey,
} from '@infra/cart/cart-keys';
import {
  deleteKey,
  expireKey,
  getAllHashJson,
  getKeyJson,
  setKeyJson,
} from '@infra/redis/redis.service';

export type CartActor = { userId?: string; guestToken?: string };

export type CartItemSnapshot = {
  foodId: string;
  quantity: number;
  priceSnapshot?: number;
  note?: string;
  menuItem?: {
    id: string;
    name: string;
    price: number;
    image: string;
    description?: string;
    category?: string;
    restaurantId: string;
    restaurantName?: string;
  };
};

export type CartSnapshot = {
  cartId: string | null;
  items: CartItemSnapshot[];
};

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  private isGuest(actor: CartActor): boolean {
    return !!actor.guestToken && !actor.userId;
  }

  // Redis helpers

  async getItemsFromRedis(cartId: string): Promise<CartItemSnapshot[]> {
    const key = cartItemsKey(cartId);
    const list = await getKeyJson<CartItemSnapshot[]>(key);
    if (Array.isArray(list)) return list;

    const legacy = await getAllHashJson<CartItemSnapshot>(key);
    const items = Object.values(legacy);
    if (items.length > 0) {
      await deleteKey(key);
      await setKeyJson(key, items);
    }
    return items;
  }

  async setItemsToRedis(
    cartId: string,
    items: CartItemSnapshot[],
    ttlSeconds?: number,
  ): Promise<void> {
    const key = cartItemsKey(cartId);
    await setKeyJson(key, items, ttlSeconds);
  }

  async snapshotCart(cartId: string): Promise<CartSnapshot> {
    const items = await this.getItemsFromRedis(cartId);
    return { cartId, items };
  }

  async clearRedisCart(cartId: string): Promise<void> {
    await deleteKey(cartItemsKey(cartId));
    await deleteKey(cartByIdKey(cartId));
  }

  async touchRedisTtl(cartId: string, ttlSeconds: number): Promise<void> {
    if (!ttlSeconds) return;
    await expireKey(cartItemsKey(cartId), ttlSeconds);
    await expireKey(cartByIdKey(cartId), ttlSeconds);
  }

  async setCartIdMapping(
    actor: CartActor,
    cartId: string,
    ttlSeconds?: number,
  ): Promise<void> {
    if (actor.userId) {
      await setKeyJson(cartIdByUserKey(actor.userId), { cartId });
    }
    if (actor.guestToken) {
      await setKeyJson(cartIdByGuestKey(actor.guestToken), { cartId }, ttlSeconds);
    }
  }

  async clearCartIdMapping(actor: CartActor): Promise<void> {
    if (actor.userId) {
      await deleteKey(cartIdByUserKey(actor.userId));
    }
    if (actor.guestToken) {
      await deleteKey(cartIdByGuestKey(actor.guestToken));
    }
  }

  async getCachedCartIdByUser(userId: string): Promise<string | null> {
    const cached = await getKeyJson<{ cartId: string }>(cartIdByUserKey(userId));
    return cached?.cartId ?? null;
  }

  async getCachedCartIdByGuest(guestToken: string): Promise<string | null> {
    const cached = await getKeyJson<{ cartId: string }>(
      cartIdByGuestKey(guestToken),
    );
    return cached?.cartId ?? null;
  }

  // DB access

  async getActiveCartFromDb(
    actor: CartActor,
  ): Promise<{ CartID: string; ExpiresAt: Date | null } | null> {
    if (actor.userId) {
      const customer = await this.prisma.customer.findFirst({
        where: { AccountID: actor.userId },
        select: { CustomerID: true },
      });
      if (!customer) return null;
      const cart = await this.prisma.cart.findFirst({
        where: {
          CustomerID: customer.CustomerID,
          Status: 'Active',
        },
        select: { CartID: true, ExpiresAt: true },
        orderBy: { CreatedAt: 'desc' },
      });
      return cart;
    }
    if (actor.guestToken) {
      const cart = await this.prisma.cart.findFirst({
        where: {
          GuestToken: actor.guestToken,
          Status: 'Active',
        },
        select: { CartID: true, ExpiresAt: true },
        orderBy: { CreatedAt: 'desc' },
      });
      return cart;
    }
    return null;
  }

  async getCartById(cartId: string): Promise<{
    CartID: string;
    Status: string;
    ExpiresAt: Date | null;
  } | null> {
    return this.prisma.cart.findUnique({
      where: { CartID: cartId },
      select: { CartID: true, Status: true, ExpiresAt: true },
    });
  }

  async createActiveCart(
    actor: CartActor,
    enterpriseId: string,
  ): Promise<string> {
    const data: Prisma.CartUncheckedCreateInput = {
      EnterpriseID: enterpriseId,
      Status: 'Active',
    };
    if (actor.userId) {
      const customer = await this.prisma.customer.findFirst({
        where: { AccountID: actor.userId },
        select: { CustomerID: true },
      });
      if (customer) {
        data.CustomerID = customer.CustomerID;
      }
    }
    if (actor.guestToken) {
      const existingByToken = await this.prisma.cart.findFirst({
        where: { GuestToken: actor.guestToken },
        select: { CartID: true, Status: true },
      });
      if (existingByToken) {
        const updated = await this.prisma.cart.update({
          where: { CartID: existingByToken.CartID },
          data: {
            Status: 'Active',
            EnterpriseID: enterpriseId,
            ExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          select: { CartID: true },
        });
        await this.setCartIdMapping(actor, updated.CartID, 60 * 60 * 24);
        return updated.CartID;
      }
      data.GuestToken = actor.guestToken;
      data.ExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    const created = await this.prisma.cart.create({
      data,
      select: { CartID: true },
    });
    await this.setCartIdMapping(
      actor,
      created.CartID,
      this.isGuest(actor) ? 60 * 60 * 24 : undefined,
    );
    return created.CartID;
  }

  async findCartItem(cartId: string, foodId: string) {
    return this.prisma.cartItem.findFirst({
      where: { CartID: cartId, FoodID: foodId },
    });
  }

  async upsertCartItemRow(
    cartId: string,
    foodId: string,
    quantityDelta: number,
    priceSnapshot: number,
    note?: string,
  ) {
    const existing = await this.findCartItem(cartId, foodId);
    if (existing) {
      await this.prisma.cartItem.update({
        where: { CartItemID: existing.CartItemID },
        data: {
          Quantity: existing.Quantity + quantityDelta,
          Note: note,
          Price: priceSnapshot,
        },
      });
      return existing.Quantity + quantityDelta;
    }
    const created = await this.prisma.cartItem.create({
      data: {
        CartID: cartId,
        FoodID: foodId,
        Quantity: Math.max(1, quantityDelta),
        Note: note,
        Price: priceSnapshot,
      },
    });
    return created.Quantity;
  }

  async setCartItemQtyRow(cartId: string, foodId: string, quantity: number) {
    const existing = await this.findCartItem(cartId, foodId);
    if (!existing) return null;
    const updated = await this.prisma.cartItem.update({
      where: { CartItemID: existing.CartItemID },
      data: { Quantity: quantity },
    });
    return updated;
  }

  async deleteCartItemRow(cartId: string, foodId: string) {
    const existing = await this.findCartItem(cartId, foodId);
    if (!existing) return;
    await this.prisma.cartItem.delete({
      where: { CartItemID: existing.CartItemID },
    });
  }

  async findFoodForCart(foodId: string) {
    return this.prisma.food.findUnique({
      where: { FoodID: foodId },
      select: {
        FoodID: true,
        DishName: true,
        Price: true,
        ImageURL: true,
        Description: true,
        EnterpriseID: true,
        foodCategory: { select: { CategoryName: true } },
        enterprise: { select: { EnterpriseName: true } },
      },
    });
  }

  async findFoodsForCart(foodIds: string[]) {
    return this.prisma.food.findMany({
      where: { FoodID: { in: foodIds } },
      select: {
        FoodID: true,
        DishName: true,
        Price: true,
        ImageURL: true,
        Description: true,
        EnterpriseID: true,
        foodCategory: { select: { CategoryName: true } },
        enterprise: { select: { EnterpriseName: true } },
      },
    });
  }

  async listCartItems(cartId: string) {
    return this.prisma.cartItem.findMany({
      where: { CartID: cartId },
      select: { FoodID: true, Quantity: true, Price: true, Note: true },
    });
  }

  async abandonCart(cartId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.cart.update({
        where: { CartID: cartId },
        data: { Status: 'Abandoned', GuestToken: null },
      }),
      this.prisma.cartItem.deleteMany({ where: { CartID: cartId } }),
    ]);
    await this.clearRedisCart(cartId);
  }

  async snapshotAndCacheFromDb(
    cartId: string,
    ttlSeconds?: number,
  ): Promise<void> {
    const items = await this.listCartItems(cartId);
    const foodIds = items.map((i) => i.FoodID);
    const foods = await this.findFoodsForCart(foodIds);
    const foodMap = new Map(foods.map((f) => [f.FoodID, f]));

    const next: CartItemSnapshot[] = [];
    for (const it of items) {
      const f = foodMap.get(it.FoodID);
      const menuItem = f
        ? {
            id: f.FoodID,
            name: f.DishName,
            price: Number(f.Price),
            image: f.ImageURL || '',
            description: f.Description || undefined,
            category: f.foodCategory?.CategoryName || undefined,
            restaurantId: f.EnterpriseID,
            restaurantName: f.enterprise?.EnterpriseName || undefined,
          }
        : undefined;
      next.push({
        foodId: it.FoodID,
        quantity: it.Quantity,
        priceSnapshot: Number(it.Price),
        note: it.Note ?? undefined,
        menuItem,
      });
    }
    await this.setItemsToRedis(cartId, next, ttlSeconds);
    await setKeyJson(cartByIdKey(cartId), { cartId });
    if (ttlSeconds) {
      await this.touchRedisTtl(cartId, ttlSeconds);
    }
  }
}

