import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VoucherCreatedBy, VoucherStatus } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { VouchersService } from '@modules/vouchers/vouchers.service';

export interface AdminCreateVoucherBody {
  Code: string;
  ExpiryDate: string;
  DiscountPercent?: number | null;
  DiscountAmount?: number | null;
  MinOrderValue?: number | null;
  MaxUsage?: number | null;
}

export interface AdminVoucherListQuery {
  status?: 'all' | 'pending' | 'approved';
  q?: string;
  limit?: number;
}

type PrismaMetaTarget = string | string[] | Record<string, string> | null | undefined;

function prismaUniqueFieldNames(target: PrismaMetaTarget): string[] {
  if (target == null) {
    return [];
  }
  if (Array.isArray(target)) {
    return target.map((item) => item);
  }
  if (typeof target === 'string') {
    return [target];
  }
  return Object.values(target);
}

@Injectable()
export class AdminVouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vouchersService: VouchersService,
  ) {}

  private validateBody(body: AdminCreateVoucherBody): void {
    const code = (body.Code ?? '').trim();
    if (!code) {
      throw new BadRequestException('Missing required fields');
    }
    if (!body.ExpiryDate?.trim()) {
      throw new BadRequestException('Missing required fields');
    }
    const hasPercent = body.DiscountPercent != null;
    const hasAmount = body.DiscountAmount != null;
    if (!hasPercent && !hasAmount) {
      throw new BadRequestException('Missing required fields');
    }
  }

  parseListQuery(input: {
    status?: string;
    q?: string;
    limit?: string;
  }): Required<AdminVoucherListQuery> {
    const statusRaw = (input.status || 'all').toLowerCase();
    const status: 'all' | 'pending' | 'approved' =
      statusRaw === 'pending' || statusRaw === 'approved' ? statusRaw : 'all';
    const q = (input.q || '').trim();
    const parsedLimit = parseInt(input.limit || '50', 10);
    const limit = Math.min(Math.max(parsedLimit || 50, 1), 200);
    return { status, q, limit };
  }

  async listVouchers(query: Required<AdminVoucherListQuery>) {
    const where: Prisma.VoucherWhereInput = {};
    if (query.status === 'pending') where.Status = VoucherStatus.Pending;
    if (query.status === 'approved') where.Status = VoucherStatus.Approved;
    if (query.q) {
      where.OR = [
        { Code: { contains: query.q } },
        { enterprise: { is: { EnterpriseName: { contains: query.q } } } },
      ];
    }

    const rows = await this.prisma.voucher.findMany({
      where,
      orderBy: { CreatedAt: 'desc' },
      take: query.limit,
      select: {
        VoucherID: true,
        Code: true,
        DiscountPercent: true,
        DiscountAmount: true,
        Status: true,
        ExpiryDate: true,
        MaxUsage: true,
        UsedCount: true,
        CreatedAt: true,
        enterprise: { select: { EnterpriseName: true } },
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.VoucherID,
        code: row.Code,
        discountPercent:
          row.DiscountPercent == null ? null : Number(row.DiscountPercent),
        discountAmount:
          row.DiscountAmount == null ? null : Number(row.DiscountAmount),
        status: row.Status,
        expiryDate: row.ExpiryDate?.toISOString() ?? null,
        maxUsage: row.MaxUsage ?? null,
        usedCount: row.UsedCount ?? 0,
        createdAt: row.CreatedAt.toISOString(),
        enterpriseName: row.enterprise?.EnterpriseName ?? null,
      })),
    };
  }

  async createVoucher(accountId: string, body: AdminCreateVoucherBody) {
    this.validateBody(body);

    const admin = await this.prisma.admin.findUnique({
      where: { AccountID: accountId },
      select: { AdminID: true },
    });
    if (!admin) {
      throw new NotFoundException(
        'Admin profile not found. Please contact system administrator to create your admin profile.',
      );
    }

    const expiry = new Date(body.ExpiryDate);
    if (Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('Invalid ExpiryDate');
    }

    try {
      const voucher = await this.prisma.voucher.create({
        data: {
          Code: String(body.Code).trim(),
          ExpiryDate: expiry,
          DiscountPercent:
            body.DiscountPercent != null
              ? new Prisma.Decimal(body.DiscountPercent)
              : null,
          DiscountAmount:
            body.DiscountAmount != null
              ? new Prisma.Decimal(body.DiscountAmount)
              : null,
          MinOrderValue:
            body.MinOrderValue != null && `${body.MinOrderValue}` !== ''
              ? new Prisma.Decimal(body.MinOrderValue)
              : null,
          MaxUsage:
            body.MaxUsage != null && `${body.MaxUsage}` !== ''
              ? Number(body.MaxUsage)
              : null,
          CreatedBy: VoucherCreatedBy.Admin,
          Status: VoucherStatus.Approved,
          AdminID: admin.AdminID,
        },
      });

      await this.vouchersService.invalidateApprovedListCache();
      return { success: true as const, voucher };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const fields = prismaUniqueFieldNames(
          (err.meta?.target as PrismaMetaTarget) ?? null,
        );
        if (fields.some((f) => f.includes('Code'))) {
          throw new ConflictException(
            'Voucher code already exists. Please use a different code.',
          );
        }
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid admin reference. Please contact system administrator.',
        );
      }
      throw err;
    }
  }

  async approveVoucher(voucherId: string): Promise<{ success: true }> {
    const existing = await this.prisma.voucher.findUnique({
      where: { VoucherID: voucherId },
      select: { VoucherID: true, Status: true },
    });
    if (!existing) {
      throw new NotFoundException('Voucher not found');
    }
    if (existing.Status !== VoucherStatus.Approved) {
      await this.prisma.voucher.update({
        where: { VoucherID: voucherId },
        data: { Status: VoucherStatus.Approved },
      });
      await this.vouchersService.invalidateApprovedListCache();
    }
    return { success: true };
  }
}
