import { Injectable } from '@nestjs/common';
import {
  CartActor,
  CartItemSnapshot,
  CartRepository,
  CartSnapshot,
} from '@infra/repositories/cart.repository';

@Injectable()
export class CartService {
  constructor(private readonly cartRepository: CartRepository) {}

  async resolveActiveCartId(actor: CartActor): Promise<string | null> {
    if (actor.userId) {
      const cachedUserCartId =
        await this.cartRepository.getCachedCartIdByUser(actor.userId);
      if (cachedUserCartId) {
        const dbCart = await this.cartRepository.getCartById(cachedUserCartId);
        if (dbCart && dbCart.Status === 'Active') {
          return dbCart.CartID;
        }
        await this.cartRepository.clearCartIdMapping(actor);
      }
    }
    if (actor.guestToken) {
      const cachedGuestCartId =
        await this.cartRepository.getCachedCartIdByGuest(actor.guestToken);
      if (cachedGuestCartId) {
        const dbCart = await this.cartRepository.getCartById(cachedGuestCartId);
        const isExpired = dbCart?.ExpiresAt
          ? dbCart.ExpiresAt.getTime() <= Date.now()
          : false;
        if (dbCart && dbCart.Status === 'Active' && !isExpired) {
          return dbCart.CartID;
        }
        if (dbCart && (dbCart.Status !== 'Active' || isExpired)) {
          await this.cartRepository.abandonCart(dbCart.CartID);
        }
        await this.cartRepository.clearCartIdMapping(actor);
      }
    }

    const dbCart = await this.cartRepository.getActiveCartFromDb(actor);
    if (!dbCart) return null;

    const isGuest = !!actor.guestToken && !actor.userId;
    if (isGuest && dbCart.ExpiresAt && dbCart.ExpiresAt.getTime() <= Date.now()) {
      await this.cartRepository.abandonCart(dbCart.CartID);
      return null;
    }

    await this.cartRepository.setCartIdMapping(
      actor,
      dbCart.CartID,
      isGuest ? 60 * 60 * 24 : undefined,
    );
    return dbCart.CartID;
  }

  async createActiveCart(
    actor: CartActor,
    enterpriseId: string,
  ): Promise<string> {
    return this.cartRepository.createActiveCart(actor, enterpriseId);
  }

  async upsertCartItem(
    cartId: string,
    foodId: string,
    quantityDelta: number,
    priceSnapshot: number,
    note?: string,
    ttlSeconds?: number,
  ): Promise<void> {
    const nextQty = await this.cartRepository.upsertCartItemRow(
      cartId,
      foodId,
      quantityDelta,
      priceSnapshot,
      note,
    );

    const food = await this.cartRepository.findFoodForCart(foodId);
    const menuItem = food
      ? {
          id: food.FoodID,
          name: food.DishName,
          price: Number(food.Price),
          image: food.ImageURL || '',
          description: food.Description || undefined,
          category: food.foodCategory?.CategoryName || undefined,
          restaurantId: food.EnterpriseID,
          restaurantName: food.enterprise?.EnterpriseName || undefined,
        }
      : undefined;

    const items = await this.cartRepository.getItemsFromRedis(cartId);
    const idx = items.findIndex((i) => i.foodId === foodId);
    const updated: CartItemSnapshot = {
      foodId,
      quantity: nextQty,
      priceSnapshot,
      note,
      menuItem,
    };
    if (idx >= 0) items[idx] = updated;
    else items.push(updated);
    await this.cartRepository.setItemsToRedis(cartId, items, ttlSeconds);
    if (ttlSeconds) {
      await this.cartRepository.touchRedisTtl(cartId, ttlSeconds);
    }
  }

  async setCartItemQty(
    cartId: string,
    foodId: string,
    quantity: number,
    ttlSeconds?: number,
  ): Promise<void> {
    if (quantity <= 0) {
      await this.cartRepository.deleteCartItemRow(cartId, foodId);
      const items = await this.cartRepository.getItemsFromRedis(cartId);
      const next = items.filter((i) => i.foodId !== foodId);
      await this.cartRepository.setItemsToRedis(cartId, next, ttlSeconds);
      return;
    }

    const existing = await this.cartRepository.setCartItemQtyRow(
      cartId,
      foodId,
      quantity,
    );
    if (existing) {
      const food = await this.cartRepository.findFoodForCart(foodId);
      const menuItem = food
        ? {
            id: food.FoodID,
            name: food.DishName,
            price: Number(food.Price),
            image: food.ImageURL || '',
            description: food.Description || undefined,
            category: food.foodCategory?.CategoryName || undefined,
            restaurantId: food.EnterpriseID,
            restaurantName: food.enterprise?.EnterpriseName || undefined,
          }
        : undefined;
      const items = await this.cartRepository.getItemsFromRedis(cartId);
      const idx = items.findIndex((i) => i.foodId === foodId);
      const updated: CartItemSnapshot = {
        foodId,
        quantity,
        priceSnapshot: Number(existing.Price),
        note: existing.Note ?? undefined,
        menuItem,
      };
      if (idx >= 0) items[idx] = updated;
      else items.push(updated);
      await this.cartRepository.setItemsToRedis(cartId, items, ttlSeconds);
    }
    if (ttlSeconds) {
      await this.cartRepository.touchRedisTtl(cartId, ttlSeconds);
    }
  }

  async hydrateRedisFromDb(
    cartId: string,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.cartRepository.snapshotAndCacheFromDb(cartId, ttlSeconds);
  }

  async snapshotCart(cartId: string): Promise<CartSnapshot> {
    return this.cartRepository.snapshotCart(cartId);
  }

  async abandonCart(cartId: string): Promise<void> {
    await this.cartRepository.abandonCart(cartId);
  }

  async mergeGuestCartIntoUserCart(
    userId: string,
    guestToken: string,
  ): Promise<void> {
    if (!userId || !guestToken) return;

    const guestCartId = await this.resolveActiveCartId({ guestToken });
    if (!guestCartId) return;

    const userCartId = await this.resolveActiveCartId({ userId });

    if (!userCartId) {
      const actorForUser: CartActor = { userId };
      const dbCart = await this.cartRepository.getCartById(guestCartId);
      if (!dbCart) return;

      await this.cartRepository.clearCartIdMapping({ guestToken });
      await this.cartRepository.setCartIdMapping(actorForUser, guestCartId);
      await this.hydrateRedisFromDb(guestCartId);
      return;
    }

    await this.hydrateRedisFromDb(guestCartId);
    const guestItems = await this.cartRepository.getItemsFromRedis(guestCartId);

    for (const it of guestItems) {
      const priceSnapshot =
        typeof it.priceSnapshot === 'number'
          ? it.priceSnapshot
          : it.menuItem?.price ?? 0;
      const quantityDelta = Math.max(1, Number(it.quantity) || 1);
      await this.upsertCartItem(
        userCartId,
        it.foodId,
        quantityDelta,
        priceSnapshot,
        it.note,
      );
    }

    await this.cartRepository.abandonCart(guestCartId);
    await this.cartRepository.clearCartIdMapping({ guestToken });
    await this.hydrateRedisFromDb(userCartId);
  }
}

