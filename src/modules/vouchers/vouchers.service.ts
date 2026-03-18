import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';

export interface VoucherDto {
  Code: string;
  DiscountAmount: number | null;
  DiscountPercent: number | null;
  MinOrderValue: number | null;
}

function toVoucherDto(row: {
  Code: string;
  DiscountAmount: unknown;
  DiscountPercent: unknown;
  MinOrderValue: unknown;
}): VoucherDto {
  return {
    Code: row.Code,
    DiscountAmount:
      row.DiscountAmount == null ? null : Number(row.DiscountAmount),
    DiscountPercent:
      row.DiscountPercent == null ? null : Number(row.DiscountPercent),
    MinOrderValue:
      row.MinOrderValue == null ? null : Number(row.MinOrderValue),
  };
}

@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(code: string): Promise<VoucherDto | null> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) return null;

    const voucher = await this.prisma.voucher.findFirst({
      where: {
        Code: trimmed,
        Status: 'Approved',
        OR: [{ ExpiryDate: null }, { ExpiryDate: { gt: new Date() } }],
      },
      select: {
        Code: true,
        DiscountAmount: true,
        DiscountPercent: true,
        MinOrderValue: true,
      },
    });

    return voucher ? toVoucherDto(voucher) : null;
  }

  async listApproved(limit = 50): Promise<VoucherDto[]> {
    const take = Math.min(Math.max(limit || 50, 1), 200);
    const cacheKey = `vouchers:approved:list:${take}`;
    const cached = await getKeyJson<VoucherDto[]>(cacheKey);
    if (cached?.length) return cached;

    const rows = await this.prisma.voucher.findMany({
      where: {
        Status: 'Approved',
        OR: [{ ExpiryDate: null }, { ExpiryDate: { gt: new Date() } }],
      },
      orderBy: { CreatedAt: 'desc' },
      take,
      select: {
        Code: true,
        DiscountAmount: true,
        DiscountPercent: true,
        MinOrderValue: true,
      },
    });

    const list = rows.map(toVoucherDto);
    await setKeyJson(cacheKey, list, 300);
    return list;
  }
}

