import { Test } from '@nestjs/testing';
import { ReturnsService } from '@modules/orders/returns/returns.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { CustomersService } from '@modules/customers/customers.service';
import { OrderStatus, Prisma } from '@prisma/client';

describe('ReturnsService', () => {
  const prismaMock = {
    order: {
      findUnique: jest.fn<Promise<any>, [any]>(),
      update: jest.fn<Promise<any>, [any]>(),
    },
    returnRequest: {
      create: jest.fn<Promise<any>, [any]>(),
      findUnique: jest.fn<Promise<any>, [any]>(),
    },
    returnRequestItem: {
      createMany: jest.fn<Promise<any>, [any]>(),
    },
    $transaction: jest.fn<any, [any]>(),
  };

  const customersMock = {
    getByAccountId: jest.fn<Promise<any>, [string]>(),
  };

  const build = async (): Promise<ReturnsService> => {
    const mod = await Test.createTestingModule({
      providers: [
        ReturnsService,
        {
          provide: PrismaService,
          useValue: prismaMock as unknown as PrismaService,
        },
        {
          provide: CustomersService,
          useValue: customersMock as unknown as CustomersService,
        },
      ],
    }).compile();
    return mod.get(ReturnsService);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    type Tx = typeof prismaMock;
    prismaMock.$transaction.mockImplementation(
      (fn: (tx: Tx) => Promise<unknown>) => fn(prismaMock),
    );
    customersMock.getByAccountId.mockResolvedValue({ CustomerID: 'c1' });
  });

  it('rejects when DeliveredAt is older than 2 hours', async () => {
    const svc = await build();
    const deliveredAt = new Date(Date.now() - 2 * 60 * 60 * 1000 - 1);
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      CustomerID: 'c1',
      Status: OrderStatus.Delivered,
      DeliveredAt: deliveredAt,
      orderDetails: [
        {
          OrderDetailID: 'od1',
          FoodID: 'f1',
          Quantity: 2,
          SubTotal: new Prisma.Decimal(10),
          food: { EnterpriseID: 'e1' },
        },
      ],
      returnRequest: null,
    });

    await expect(
      svc.createReturnRequestForCustomer('a1', 'o1', {
        items: [{ orderDetailId: 'od1', quantity: 1 }],
        reasonCode: 'other',
      }),
    ).rejects.toThrow('Return window expired');
  });

  it('rejects quantity greater than ordered quantity', async () => {
    const svc = await build();
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      CustomerID: 'c1',
      Status: OrderStatus.Delivered,
      DeliveredAt: new Date(),
      orderDetails: [
        {
          OrderDetailID: 'od1',
          FoodID: 'f1',
          Quantity: 2,
          SubTotal: new Prisma.Decimal(10),
          food: { EnterpriseID: 'e1' },
        },
      ],
      returnRequest: null,
    });

    await expect(
      svc.createReturnRequestForCustomer('a1', 'o1', {
        items: [{ orderDetailId: 'od1', quantity: 3 }],
        reasonCode: 'missing_items',
      }),
    ).rejects.toThrow('Invalid quantity');
  });

  it('enforces single-enterprise order for return requests', async () => {
    const svc = await build();
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      CustomerID: 'c1',
      Status: OrderStatus.Delivered,
      DeliveredAt: new Date(),
      orderDetails: [
        {
          OrderDetailID: 'od1',
          FoodID: 'f1',
          Quantity: 1,
          SubTotal: new Prisma.Decimal(5),
          food: { EnterpriseID: 'e1' },
        },
        {
          OrderDetailID: 'od2',
          FoodID: 'f2',
          Quantity: 1,
          SubTotal: new Prisma.Decimal(6),
          food: { EnterpriseID: 'e2' },
        },
      ],
      returnRequest: null,
    });

    await expect(
      svc.createReturnRequestForCustomer('a1', 'o1', {
        items: [{ orderDetailId: 'od1', quantity: 1 }],
        reasonCode: 'wrong_item',
      }),
    ).rejects.toThrow('Multi-enterprise orders are not supported');
  });

  it('computes requestedAmount from SubTotal/Quantity and creates rows in transaction', async () => {
    const svc = await build();
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      CustomerID: 'c1',
      Status: OrderStatus.Delivered,
      DeliveredAt: new Date(),
      orderDetails: [
        {
          OrderDetailID: 'od1',
          FoodID: 'f1',
          Quantity: 4,
          SubTotal: new Prisma.Decimal('10.00'), // unit 2.5
          food: { EnterpriseID: 'e1' },
        },
      ],
      returnRequest: null,
    });

    prismaMock.returnRequest.create.mockResolvedValue({
      ReturnRequestID: 'rr1',
      OrderID: 'o1',
      Status: 'PendingReview',
      ReasonCode: 'other',
      ReasonText: null,
      RequestedSolution: 'RefundOnly',
      RequestedAmount: new Prisma.Decimal('5.00'),
      CreatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prismaMock.returnRequestItem.createMany.mockResolvedValue({ count: 1 });
    prismaMock.order.update.mockResolvedValue({});

    const res = await svc.createReturnRequestForCustomer('a1', 'o1', {
      items: [{ orderDetailId: 'od1', quantity: 2 }],
      reasonCode: 'other',
    });

    expect(res.success).toBe(true);
    expect(res.returnRequest.requestedAmount).toBe(5);
    expect(prismaMock.returnRequest.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.returnRequestItem.createMany).toHaveBeenCalledTimes(1);
  });
});
