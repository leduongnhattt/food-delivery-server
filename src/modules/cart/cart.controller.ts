import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { verify as jwtVerify } from 'jsonwebtoken';
import { CartService } from '@modules/cart/cart.service';
import { ONE_DAY_SECONDS } from '@infra/cart/cart-keys';
import { PrismaService } from '@infra/prisma/prisma.service';

type Actor = { userId?: string; guestToken?: string };

type AddItemBody = {
  foodId?: string;
  quantity?: number | string;
  note?: string;
};

type UpdateItemBody = {
  quantity?: number | string;
};

type JwtVerifyFn = (token: string, secretOrPublicKey: string) => unknown;

const safeJwtVerify: JwtVerifyFn = jwtVerify as unknown as JwtVerifyFn;

function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.split('=');
    if (!name) continue;
    const key = name.trim();
    const value = rest.join('=').trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function getActorFromRequest(req: Request): Actor {
  let userId = (req.headers['x-user-id'] as string) || undefined;
  const authHeader = req.headers['authorization'];

  if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.replace('Bearer ', '');
    try {
      const decoded = safeJwtVerify(
        bearer,
        process.env.JWT_SECRET || 'change-me',
      ) as { accountId?: string; role?: string };
      if (
        decoded?.accountId &&
        decoded.role &&
        decoded.role.toLowerCase() === 'customer'
      ) {
        userId = decoded.accountId;
      }
    } catch {
      // ignore invalid tokens; treated as guest
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieGuest = cookies['guest_token'];
  const guestToken = userId ? undefined : cookieGuest;

  return { userId, guestToken };
}

@Controller('cart')
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getCart(@Req() req: Request, @Res() res: Response) {
    try {
      const actor = getActorFromRequest(req);
      const cookies = parseCookies(req.headers.cookie);
      const guestToken = cookies['guest_token'];

      if (actor.userId && guestToken) {
        await this.cartService.mergeGuestCartIntoUserCart(
          actor.userId,
          guestToken,
        );
      }

      const cartId = await this.cartService.resolveActiveCartId(actor);
      if (!cartId) {
        return res.status(200).json({ cartId: null, items: [] });
      }

      await this.cartService.hydrateRedisFromDb(
        cartId,
        actor.guestToken ? ONE_DAY_SECONDS : undefined,
      );
      const snap = await this.cartService.snapshotCart(cartId);
      return res.status(200).json(snap);
    } catch (e) {
      console.error('GET /cart failed', e);
      return res.status(500).json({ error: 'Failed to get cart' });
    }
  }

  @Delete()
  async clearCart(@Req() req: Request, @Res() res: Response) {
    try {
      const actor = getActorFromRequest(req);
      const cartId = await this.cartService.resolveActiveCartId(actor);
      if (!cartId) {
        return res.status(204).send();
      }
      await this.cartService.abandonCart(cartId);
      return res.status(204).send();
    } catch (e) {
      console.error('DELETE /cart failed', e);
      return res.status(500).json({ error: 'Failed to clear cart' });
    }
  }

  @Post('items')
  async addItem(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: AddItemBody,
  ) {
    try {
      const actor = getActorFromRequest(req);
      const foodId = body.foodId ?? '';
      const qty = Number(body.quantity ?? 1);
      const note = body.note;
      if (!foodId || qty <= 0) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      let cartId = await this.cartService.resolveActiveCartId(actor);
      const food = await this.prisma.food.findUnique({
        where: { FoodID: foodId },
        select: { EnterpriseID: true, Price: true },
      });
      if (!food) {
        return res.status(404).json({ error: 'Food not found' });
      }

      if (!cartId) {
        cartId = await this.cartService.createActiveCart(
          actor,
          food.EnterpriseID,
        );
      }

      await this.cartService.upsertCartItem(
        cartId,
        foodId,
        qty,
        Number(food.Price),
        note,
        actor.guestToken ? ONE_DAY_SECONDS : undefined,
      );

      const snap = await this.cartService.snapshotCart(cartId);
      return res.status(200).json(snap);
    } catch (e) {
      console.error('POST /cart/items failed', e);
      return res.status(500).json({ error: 'Failed to add item' });
    }
  }

  @Patch('items/:foodId')
  async updateItem(
    @Req() req: Request,
    @Res() res: Response,
    @Param('foodId') foodId: string,
    @Body() body: UpdateItemBody,
  ) {
    try {
      const actor = getActorFromRequest(req);
      const qty = Number(body.quantity);
      if (!foodId || Number.isNaN(qty)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const cartId = await this.cartService.resolveActiveCartId(actor);
      if (!cartId) {
        return res.status(404).json({ error: 'Cart not found' });
      }

      await this.cartService.setCartItemQty(
        cartId,
        foodId,
        qty,
        actor.guestToken ? ONE_DAY_SECONDS : undefined,
      );
      const snap = await this.cartService.snapshotCart(cartId);
      return res.status(200).json(snap);
    } catch (e) {
      console.error('PATCH /cart/items/:foodId failed', e);
      return res.status(500).json({ error: 'Failed to update item' });
    }
  }
}
