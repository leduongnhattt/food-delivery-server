import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { VoucherStatus } from '@prisma/client';
import { computeVoucherDiscountFromRow } from '@common/utils/voucher-discount.util';
import {
  deleteKey,
  deleteKeysMatchingPattern,
  getKeyJson,
  setKeyJson,
} from '@infra/redis/redis.service';

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
        Status: VoucherStatus.Approved,
        OR: [{ ExpiryDate: null }, { ExpiryDate: { gt: new Date() } }],
      },
      select: {
        Code: true,
        DiscountAmount: true,
        DiscountPercent: true,
        MinOrderValue: true,
        MaxUsage: true,
        UsedCount: true,
      },
    });

    if (!voucher) return null;
    if (
      voucher.MaxUsage != null &&
      voucher.UsedCount >= voucher.MaxUsage
    ) {
      return null;
    }

    return toVoucherDto(voucher);
  }

  async listApproved(limit = 50): Promise<VoucherDto[]> {
    const take = Math.min(Math.max(limit || 50, 1), 200);
    const cacheKey = `vouchers:approved:list:${take}`;
    const cached = await getKeyJson<VoucherDto[]>(cacheKey);
    if (cached?.length) return cached;

    const rows = await this.prisma.voucher.findMany({
      where: {
        Status: VoucherStatus.Approved,
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

  /**
   * Clears cached approved voucher lists (all TTL variants + legacy key used by Next.js).
   */
  async invalidateApprovedListCache(): Promise<void> {
    await deleteKey('vouchers:approved:list');
    await deleteKeysMatchingPattern('vouchers:approved:list:*');
  }

  /**
   * Resolves an approved voucher for checkout: expiry, usage cap, enterprise scope,
   * min order, and percent vs amount discount on subtotal.
   */
  async findApplicableVoucherForOrder(params: {
    code: string;
    subtotal: number;
    cartRestaurantIds: string[];
  }): Promise<{ voucherId: string; discount: number } | null> {
    const trimmed = (params.code ?? '').trim();
    if (!trimmed) return null;

    const row = await this.prisma.voucher.findFirst({
      where: {
        Code: trimmed,
        Status: VoucherStatus.Approved,
        OR: [{ ExpiryDate: null }, { ExpiryDate: { gt: new Date() } }],
      },
      select: {
        VoucherID: true,
        EnterpriseID: true,
        DiscountAmount: true,
        DiscountPercent: true,
        MinOrderValue: true,
        MaxUsage: true,
        UsedCount: true,
      },
    });
    if (!row) return null;
    if (row.MaxUsage != null && row.UsedCount >= row.MaxUsage) {
      return null;
    }

    const voucherEnterprise = (row.EnterpriseID ?? '').trim();
    const cartIds = [
      ...new Set(
        params.cartRestaurantIds.map((x) => x.trim()).filter((id) => id.length > 0),
      ),
    ];
    if (voucherEnterprise) {
      if (cartIds.length !== 1 || !cartIds.includes(voucherEnterprise)) {
        return null;
      }
    }

    const discount = computeVoucherDiscountFromRow({
      subtotal: params.subtotal,
      discountPercent:
        row.DiscountPercent == null ? null : Number(row.DiscountPercent),
      discountAmount:
        row.DiscountAmount == null ? null : Number(row.DiscountAmount),
      minOrderValue:
        row.MinOrderValue == null ? null : Number(row.MinOrderValue),
    });
    if (discount <= 0) return null;

    return { voucherId: row.VoucherID, discount };
  }
}

