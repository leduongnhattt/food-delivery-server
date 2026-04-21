import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { CartRepository } from '@infra/repositories/cart.repository';
import { CartService } from '@modules/cart/cart.service';

describe('CartService.populateCartFromOrder', () => {
  const prismaMock = {
    customer: { findFirst: jest.fn() },
    order: { findFirst: jest.fn() },
  };

  const cartRepoMock = {
    resolveActiveCartId: jest.fn(),
    abandonCart: jest.fn(),
    createActiveCart: jest.fn(),
    hydrateRedisFromDb: jest.fn(),
    snapshotCart: jest.fn(),
  };

  async function buildService(): Promise<CartService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CartRepository, useValue: cartRepoMock },
      ],
    }).compile();
    return moduleRef.get(CartService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.customer.findFirst.mockResolvedValue({ CustomerID: 'cust-1' });
    cartRepoMock.resolveActiveCartId.mockResolvedValue(null);
    cartRepoMock.createActiveCart.mockResolvedValue('cart-1');
    cartRepoMock.hydrateRedisFromDb.mockResolvedValue(undefined);
    cartRepoMock.snapshotCart.mockResolvedValue({
      cartId: 'cart-1',
      items: [],
    });
  });

  it('throws NotFoundException when customer missing', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);
    const svc = await buildService();
    await expect(svc.populateCartFromOrder('acc-1', 'ord-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when order missing', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);
    const svc = await buildService();
    await expect(svc.populateCartFromOrder('acc-1', 'ord-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException when order is not delivered or completed', async () => {
    prismaMock.order.findFirst.mockResolvedValue({
      CustomerID: 'cust-1',
      Status: OrderStatus.Pending,
      orderDetails: [],
    });
    const svc = await buildService();
    await expect(svc.populateCartFromOrder('acc-1', 'ord-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when a food line is unavailable', async () => {
    prismaMock.order.findFirst.mockResolvedValue({
      CustomerID: 'cust-1',
      Status: OrderStatus.Delivered,
      orderDetails: [
        {
          FoodID: 'f1',
          Quantity: 1,
          Metadata: null,
          food: {
            FoodID: 'f1',
            EnterpriseID: 'e1',
            DishName: 'Pho',
            Price: 10,
            IsAvailable: false,
          },
        },
      ],
    });
    const svc = await buildService();
    await expect(svc.populateCartFromOrder('acc-1', 'ord-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('abandons existing cart, creates cart, upserts lines, and returns snapshot', async () => {
    prismaMock.order.findFirst.mockResolvedValue({
      CustomerID: 'cust-1',
      Status: OrderStatus.Delivered,
      orderDetails: [
        {
          FoodID: 'f1',
          Quantity: 2,
          Metadata: { note: 'Extra lime' },
          food: {
            FoodID: 'f1',
            EnterpriseID: 'e1',
            DishName: 'Pho',
            Price: 10,
            IsAvailable: true,
          },
        },
      ],
    });
    const svc = await buildService();
    const resolveSpy = jest
      .spyOn(svc, 'resolveActiveCartId')
      .mockResolvedValue('old-cart');
    const spy = jest.spyOn(svc, 'upsertCartItem').mockResolvedValue(undefined);
    const hydrateSpy = jest
      .spyOn(svc, 'hydrateRedisFromDb')
      .mockResolvedValue(undefined);

    const snap = await svc.populateCartFromOrder('acc-1', 'ord-1');

    expect(cartRepoMock.abandonCart).toHaveBeenCalledWith('old-cart');
    expect(cartRepoMock.createActiveCart).toHaveBeenCalledWith(
      { userId: 'acc-1' },
      'e1',
    );
    expect(spy).toHaveBeenCalledWith('cart-1', 'f1', 2, 10, 'Extra lime');
    expect(snap).toEqual({ cartId: 'cart-1', items: [] });
    expect(hydrateSpy).toHaveBeenCalledWith('cart-1');
    spy.mockRestore();
    resolveSpy.mockRestore();
    hydrateSpy.mockRestore();
  });
});
