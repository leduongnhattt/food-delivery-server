import { Test } from '@nestjs/testing';
import { EtaService } from '@modules/shipping/eta.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { MapboxClient } from '@infra/mapbox/mapbox.client';

jest.mock('@infra/redis/redis.service', () => ({
  getKeyJson: jest.fn(async () => null),
  setKeyJson: jest.fn(async () => undefined),
}));

describe('EtaService', () => {
  const prisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    enterprise: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaService;

  const mapbox = {
    forwardGeocode: jest.fn(),
    matrixDuration: jest.fn(),
  } as unknown as MapboxClient;

  const build = async () => {
    const mod = await Test.createTestingModule({
      providers: [
        EtaService,
        { provide: PrismaService, useValue: prisma },
        { provide: MapboxClient, useValue: mapbox },
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
    prisma.order.findUnique = jest.fn(async () => ({
      OrderID: 'o1',
      OrderDate: orderDate,
      EstimatedDeliveryTime: null,
      Metadata: null,
    })) as any;
    prisma.enterprise.findUnique = jest.fn(async () => ({
      Latitude: 10.0,
      Longitude: 106.0,
    })) as any;
    (mapbox.matrixDuration as any) = jest.fn(async () => ({
      durationSeconds: 900, // 15 min
      distanceMeters: 2500,
    }));

    await svc.computeAndPersistForOrder({
      orderId: 'o1',
      enterpriseId: 'e1',
      deliveryInfo: { address: 'X', lat: 10.1, lng: 106.1 },
    });

    expect(mapbox.forwardGeocode).not.toHaveBeenCalled();
    expect(mapbox.matrixDuration).toHaveBeenCalled();
    expect(prisma.order.update).toHaveBeenCalledTimes(1);

    const updateArg = (prisma.order.update as any).mock.calls[0]?.[0];
    expect(updateArg.where.OrderID).toBe('o1');
    expect(updateArg.data.EstimatedDeliveryTime).toBeInstanceOf(Date);
  });

  it('falls back to legacy 45 minutes when origin/destination cannot be resolved', async () => {
    const svc = await build();
    const orderDate = new Date('2026-01-01T00:00:00.000Z');
    prisma.order.findUnique = jest.fn(async () => ({
      OrderID: 'o1',
      OrderDate: orderDate,
      EstimatedDeliveryTime: null,
      Metadata: null,
    })) as any;
    prisma.enterprise.findUnique = jest.fn(async () => ({
      Latitude: null,
      Longitude: null,
    })) as any;
    (mapbox.forwardGeocode as any) = jest.fn(async () => null);

    const res = await svc.computeAndPersistForOrder({
      orderId: 'o1',
      enterpriseId: 'e1',
      deliveryInfo: { address: 'unknown address' },
    });

    expect(res.source).toBe('fallback');
    expect(res.etaMinutes).toBe(45);
    expect(prisma.order.update).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite existing EstimatedDeliveryTime unless force=true', async () => {
    const svc = await build();
    const existing = new Date('2026-01-01T01:00:00.000Z');
    prisma.order.findUnique = jest.fn(async () => ({
      OrderID: 'o1',
      OrderDate: new Date('2026-01-01T00:00:00.000Z'),
      EstimatedDeliveryTime: existing,
      Metadata: null,
    })) as any;

    const res = await svc.computeAndPersistForOrder({
      orderId: 'o1',
      enterpriseId: 'e1',
      deliveryInfo: { address: 'X', lat: 10.1, lng: 106.1 },
    });

    expect(res.estimatedDeliveryTime).toBe(existing);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

