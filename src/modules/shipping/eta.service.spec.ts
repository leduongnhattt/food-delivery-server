import { Test } from '@nestjs/testing';
import { EtaService } from '@modules/shipping/eta.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { MapboxClient } from '@infra/mapbox/mapbox.client';

jest.mock('@infra/redis/redis.service', () => ({
  getKeyJson: jest.fn(() => null),
  setKeyJson: jest.fn(() => undefined),
}));

describe('EtaService', () => {
  type OrderRow = {
    OrderID: string;
    OrderDate: Date;
    EstimatedDeliveryTime: Date | null;
    Metadata: unknown;
  };

  type EnterpriseRow = {
    Latitude: number | null;
    Longitude: number | null;
  };

  type OrderUpdateArg = {
    where: { OrderID: string };
    data: { EstimatedDeliveryTime?: Date | null };
  };

  const prismaMock = {
    order: {
      findUnique: jest.fn<Promise<OrderRow | null>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [OrderUpdateArg]>(),
    },
    enterprise: {
      findUnique: jest.fn<Promise<EnterpriseRow | null>, [unknown]>(),
    },
  };

  const mapboxMock = {
    forwardGeocode: jest.fn<Promise<{ lat: number; lng: number; placeName: string | null } | null>, [unknown]>(),
    matrixDuration: jest.fn<Promise<{ durationSeconds: number; distanceMeters: number } | null>, [unknown]>(),
  };

  const build = async (): Promise<EtaService> => {
    const mod = await Test.createTestingModule({
      providers: [
        EtaService,
        { provide: PrismaService, useValue: prismaMock as unknown as PrismaService },
        { provide: MapboxClient, useValue: mapboxMock as unknown as MapboxClient },
      ],
    }).compile();
    return mod.get(EtaService);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.ETA_BASE_PREP_MINUTES = '20';
    process.env.ETA_MIN_MINUTES = '30';
    process.env.ETA_MAX_MINUTES = '180';
  });

  it('uses GPS lat/lng when provided and persists EstimatedDeliveryTime', async () => {
    const svc = await build();
    const orderDate = new Date('2026-01-01T00:00:00.000Z');
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      OrderDate: orderDate,
      EstimatedDeliveryTime: null,
      Metadata: null,
    });
    prismaMock.enterprise.findUnique.mockResolvedValue({
      Latitude: 10.0,
      Longitude: 106.0,
    });
    mapboxMock.matrixDuration.mockResolvedValue({
      durationSeconds: 900, // 15 min
      distanceMeters: 2500,
    });

    await svc.computeAndPersistForOrder({
      orderId: 'o1',
      enterpriseId: 'e1',
      deliveryInfo: { address: 'X', lat: 10.1, lng: 106.1 },
    });

    expect(mapboxMock.forwardGeocode).not.toHaveBeenCalled();
    expect(mapboxMock.matrixDuration).toHaveBeenCalled();
    expect(prismaMock.order.update).toHaveBeenCalledTimes(1);

    const updateArg = prismaMock.order.update.mock.calls[0]?.[0];
    expect(updateArg.where.OrderID).toBe('o1');
    expect(updateArg.data.EstimatedDeliveryTime).toBeInstanceOf(Date);
  });

  it('falls back to legacy 45 minutes when origin/destination cannot be resolved', async () => {
    const svc = await build();
    const orderDate = new Date('2026-01-01T00:00:00.000Z');
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      OrderDate: orderDate,
      EstimatedDeliveryTime: null,
      Metadata: null,
    });
    prismaMock.enterprise.findUnique.mockResolvedValue({
      Latitude: null,
      Longitude: null,
    });
    mapboxMock.forwardGeocode.mockResolvedValue(null);

    const res = await svc.computeAndPersistForOrder({
      orderId: 'o1',
      enterpriseId: 'e1',
      deliveryInfo: { address: 'unknown address' },
    });

    expect(res.source).toBe('fallback');
    expect(res.etaMinutes).toBe(45);
    expect(prismaMock.order.update).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite existing EstimatedDeliveryTime unless force=true', async () => {
    const svc = await build();
    const existing = new Date('2026-01-01T01:00:00.000Z');
    prismaMock.order.findUnique.mockResolvedValue({
      OrderID: 'o1',
      OrderDate: new Date('2026-01-01T00:00:00.000Z'),
      EstimatedDeliveryTime: existing,
      Metadata: null,
    });

    const res = await svc.computeAndPersistForOrder({
      orderId: 'o1',
      enterpriseId: 'e1',
      deliveryInfo: { address: 'X', lat: 10.1, lng: 106.1 },
    });

    expect(res.estimatedDeliveryTime).toBe(existing);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });
});

