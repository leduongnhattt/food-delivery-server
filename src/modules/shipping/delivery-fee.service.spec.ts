import { Test } from '@nestjs/testing';
import { DeliveryFeeService } from '@modules/shipping/delivery-fee.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { MapboxClient } from '@infra/mapbox/mapbox.client';

jest.mock('@infra/redis/redis.service', () => ({
  getKeyJson: jest.fn(() => null),
  setKeyJson: jest.fn(() => undefined),
}));

describe('DeliveryFeeService', () => {
  const prismaMock = {
    enterprise: {
      findUnique: jest.fn(),
    },
  };

  const mapboxMock = {
    forwardGeocode: jest.fn(),
    matrixDuration: jest.fn(),
  };

  async function build(): Promise<DeliveryFeeService> {
    const mod = await Test.createTestingModule({
      providers: [
        DeliveryFeeService,
        { provide: PrismaService, useValue: prismaMock as unknown as PrismaService },
        { provide: MapboxClient, useValue: mapboxMock as unknown as MapboxClient },
      ],
    }).compile();
    return mod.get(DeliveryFeeService);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.DELIVERY_FEE_BASE = '0.5';
    process.env.DELIVERY_FEE_PER_KM = '0.2';
    process.env.DELIVERY_FEE_MIN = '0.5';
    process.env.DELIVERY_FEE_MAX = '5';
  });

  it('computes fee using ceil(km) from matrix distance', async () => {
    const svc = await build();
    prismaMock.enterprise.findUnique.mockResolvedValue({
      Latitude: 10,
      Longitude: 106,
      Address: 'X',
    });
    mapboxMock.matrixDuration.mockResolvedValue({
      durationSeconds: 600,
      distanceMeters: 2500, // 2.5km => billed 3km
    });

    const q = await svc.quoteForEnterprise({
      enterpriseId: 'e1',
      deliveryInfo: { address: 'Y', lat: 10.1, lng: 106.1 },
    });

    // 0.5 + 0.2*3 = 1.1
    expect(q.deliveryFee).toBe(1.1);
    expect(q.distanceMeters).toBe(2500);
    expect(q.source).toBe('matrix');
  });

  it('falls back when destination cannot be resolved', async () => {
    const svc = await build();
    prismaMock.enterprise.findUnique.mockResolvedValue({
      Latitude: null,
      Longitude: null,
      Address: '',
    });
    mapboxMock.forwardGeocode.mockResolvedValue(null);

    const q = await svc.quoteForEnterprise({
      enterpriseId: 'e1',
      deliveryInfo: { address: '' },
    });

    expect(q.source).toBe('fallback');
    expect(q.deliveryFee).toBe(0.5);
    expect(q.distanceMeters).toBeNull();
  });
});

