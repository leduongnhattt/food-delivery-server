import { Test } from '@nestjs/testing';
import { EnterpriseReturnsService } from '@modules/enterprise/returns/enterprise-returns.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { ReturnRequestStatus } from '@prisma/client';

jest.mock('@modules/enterprise/orders/enterprise-order-cache.util', () => ({
  invalidateEnterpriseOrderCaches: jest.fn(() => Promise.resolve()),
}));

describe('EnterpriseReturnsService', () => {
  const prismaMock = {
    enterprise: {
      findFirst: jest.fn<Promise<any>, [any]>(),
    },
    returnRequest: {
      findFirst: jest.fn<Promise<any>, [any]>(),
      update: jest.fn<Promise<any>, [any]>(),
    },
    order: {
      findUnique: jest.fn<Promise<any>, [any]>(),
      update: jest.fn<Promise<any>, [any]>(),
    },
    $transaction: jest.fn<any, [any]>(),
  };

  const build = async (): Promise<EnterpriseReturnsService> => {
    const mod = await Test.createTestingModule({
      providers: [
        EnterpriseReturnsService,
        {
          provide: PrismaService,
          useValue: prismaMock as unknown as PrismaService,
        },
      ],
    }).compile();
    return mod.get(EnterpriseReturnsService);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.enterprise.findFirst.mockResolvedValue({ EnterpriseID: 'e1' });
    type Tx = typeof prismaMock;
    prismaMock.$transaction.mockImplementation(
      (fn: (tx: Tx) => Promise<unknown>) => fn(prismaMock),
    );
  });

  it('allows transition PendingReview -> Approved and sets order refundPending metadata', async () => {
    const svc = await build();
    prismaMock.returnRequest.findFirst.mockResolvedValue({
      ReturnRequestID: 'rr1',
      OrderID: 'o1',
      Status: ReturnRequestStatus.PendingReview,
      Metadata: null,
    });
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      Metadata: { foo: 'bar' },
    });
    prismaMock.returnRequest.update.mockResolvedValue({});
    prismaMock.order.update.mockResolvedValue({});

    const res = await svc.updateStatus('acc1', 'rr1', {
      status: 'Approved',
      internalNote: 'ok',
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe(ReturnRequestStatus.Approved);
    expect(prismaMock.order.update).toHaveBeenCalledTimes(1);
    const orderUpdateCall = prismaMock.order.update.mock.calls[0];
    expect(orderUpdateCall).toBeDefined();
    const updateArg = orderUpdateCall[0] as {
      data: { Metadata: Record<string, unknown> };
    };
    expect(updateArg.data.Metadata['refundPending']).toBe(true);
    expect(updateArg.data.Metadata['returnRequestId']).toBe('rr1');
  });

  it('rejects transition when status is not PendingReview', async () => {
    const svc = await build();
    prismaMock.returnRequest.findFirst.mockResolvedValue({
      ReturnRequestID: 'rr1',
      OrderID: 'o1',
      Status: ReturnRequestStatus.Approved,
      Metadata: null,
    });

    await expect(
      svc.updateStatus('acc1', 'rr1', { status: 'Rejected' }),
    ).rejects.toThrow('Cannot transition');
  });
});
