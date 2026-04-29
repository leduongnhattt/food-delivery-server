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

export interface AdminUpdateVoucherBody {
  Code: string;
  ExpiryDate: string;
  DiscountPercent?: number | null;
  DiscountAmount?: number | null;
  MinOrderValue?: number | null;
  MaxUsage?: number | null;
}

export interface AdminVoucherListQuery {
  status?: 'all' | 'pending' | 'approved' | 'rejected' | 'expired';
  q?: string;
  page?: number;
  limit?: number;
  range?: 'all' | '7d' | '30d' | '90d';
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
  ) { }

  private mapVoucherRow(row: {
    VoucherID: string;
    EnterpriseID?: string | null;
    AdminID?: string | null;
    Code: string;
    DiscountPercent: Prisma.Decimal | null;
    DiscountAmount: Prisma.Decimal | null;
    CreatedBy: VoucherCreatedBy | null;
    Status: VoucherStatus;
    ExpiryDate: Date | null;
    MaxUsage: number | null;
    UsedCount: number | null;
    MinOrderValue?: Prisma.Decimal | null;
    CreatedAt: Date;
    UpdatedAt?: Date | null;
    enterprise?: { EnterpriseName: string } | null;
    admin?: { account?: { Username: string | null; Email: string } | null } | null;
  }) {
    return {
      id: row.VoucherID,
      enterpriseId: row.EnterpriseID ?? null,
      adminId: row.AdminID ?? null,
      code: row.Code,
      discountPercent: row.DiscountPercent == null ? null : Number(row.DiscountPercent),
      discountAmount: row.DiscountAmount == null ? null : Number(row.DiscountAmount),
      createdBy: row.CreatedBy ?? null,
      status: row.Status,
      expiryDate: row.ExpiryDate?.toISOString() ?? null,
      maxUsage: row.MaxUsage ?? null,
      usedCount: row.UsedCount ?? 0,
      minOrderValue: row.MinOrderValue == null ? null : Number(row.MinOrderValue),
      createdAt: row.CreatedAt.toISOString(),
      updatedAt: row.UpdatedAt?.toISOString() ?? null,
      enterpriseName: row.enterprise?.EnterpriseName ?? null,
      createdByLabel:
        row.CreatedBy === VoucherCreatedBy.Admin
          ? row.admin?.account?.Username ||
          row.admin?.account?.Email ||
          'Admin'
          : row.enterprise?.EnterpriseName ?? 'Enterprise',
    };
  }

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
    if (hasPercent === hasAmount) {
      throw new BadRequestException('Missing required fields');
    }

    if (hasPercent) {
      const n = Number(body.DiscountPercent);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        throw new BadRequestException('Invalid DiscountPercent');
      }
    }
    if (hasAmount) {
      const n = Number(body.DiscountAmount);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestException('Invalid DiscountAmount');
      }
    }
    if (body.MinOrderValue != null) {
      const n = Number(body.MinOrderValue);
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException('Invalid MinOrderValue');
      }
    }
    if (body.MaxUsage != null) {
      const n = Number(body.MaxUsage);
      if (!Number.isFinite(n) || n < 1) {
        throw new BadRequestException('Invalid MaxUsage');
      }
    }
  }

  private validateUpdateBody(body: AdminUpdateVoucherBody): void {
    this.validateBody(body);
  }

  parseListQuery(input: {
    status?: string;
    q?: string;
    page?: string;
    limit?: string;
    range?: string;
  }): Required<AdminVoucherListQuery> {
    const statusRaw = (input.status || 'all').toLowerCase();
    const status: 'all' | 'pending' | 'approved' | 'rejected' | 'expired' =
      statusRaw === 'pending' ||
      statusRaw === 'approved' ||
      statusRaw === 'rejected' ||
      statusRaw === 'expired'
        ? (statusRaw as any)
        : 'all';
    const q = (input.q || '').trim();
    const parsedPage = parseInt(input.page || '1', 10);
    const page = Math.max(parsedPage || 1, 1);
    const parsedLimit = parseInt(input.limit || '50', 10);
    const limit = Math.min(Math.max(parsedLimit || 50, 1), 200);

    const rangeRaw = String(input.range || 'all').toLowerCase();
    const range: 'all' | '7d' | '30d' | '90d' =
      rangeRaw === '7d' || rangeRaw === '30d' || rangeRaw === '90d' ? (rangeRaw as any) : 'all';

    return { status, q, page, limit, range };
  }

  async listVouchers(query: Required<AdminVoucherListQuery>) {
    const where: Prisma.VoucherWhereInput = {};
    if (query.status === 'pending') where.Status = VoucherStatus.Pending;
    if (query.status === 'approved') where.Status = VoucherStatus.Approved;
    if (query.status === 'rejected') where.Status = VoucherStatus.Rejected;
    if (query.status === 'expired') where.Status = VoucherStatus.Expired;
    if (query.q) {
      where.OR = [
        { Code: { contains: query.q } },
        { enterprise: { is: { EnterpriseName: { contains: query.q } } } },
      ];
    }
    if (query.range !== 'all') {
      const days = query.range === '7d' ? 7 : query.range === '30d' ? 30 : 90;
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      where.CreatedAt = { gte: from };
    }

    const total = await this.prisma.voucher.count({ where });
    const skip = (query.page - 1) * query.limit;

    const rows = await this.prisma.voucher.findMany({
      where,
      orderBy: { CreatedAt: 'desc' },
      skip,
      take: query.limit,
      select: {
        VoucherID: true,
        Code: true,
        DiscountPercent: true,
        DiscountAmount: true,
        CreatedBy: true,
        Status: true,
        ExpiryDate: true,
        MaxUsage: true,
        UsedCount: true,
        CreatedAt: true,
        enterprise: { select: { EnterpriseName: true } },
        admin: {
          select: {
            account: { select: { Username: true, Email: true } },
          },
        },
      },
    });

    return {
      items: rows.map((row) => this.mapVoucherRow(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getVoucherDetail(voucherId: string) {
    const row = await this.prisma.voucher.findUnique({
      where: { VoucherID: voucherId },
      select: {
        VoucherID: true,
        EnterpriseID: true,
        AdminID: true,
        Code: true,
        DiscountPercent: true,
        DiscountAmount: true,
        CreatedBy: true,
        Status: true,
        ExpiryDate: true,
        MaxUsage: true,
        UsedCount: true,
        MinOrderValue: true,
        CreatedAt: true,
        UpdatedAt: true,
        enterprise: { select: { EnterpriseName: true } },
        admin: { select: { account: { select: { Username: true, Email: true } } } },
      },
    });
    if (!row) {
      throw new NotFoundException('Voucher not found');
    }
    return { voucher: this.mapVoucherRow(row) };
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

  async rejectVoucher(voucherId: string): Promise<{ success: true }> {
    const existing = await this.prisma.voucher.findUnique({
      where: { VoucherID: voucherId },
      select: { VoucherID: true, Status: true },
    });
    if (!existing) {
      throw new NotFoundException('Voucher not found');
    }

    const wasApproved = existing.Status === VoucherStatus.Approved;
    if (existing.Status !== VoucherStatus.Rejected) {
      await this.prisma.voucher.update({
        where: { VoucherID: voucherId },
        data: { Status: VoucherStatus.Rejected },
      });
    }
    if (wasApproved) {
      await this.vouchersService.invalidateApprovedListCache();
    }
    return { success: true };
  }

  async updateVoucher(voucherId: string, body: AdminUpdateVoucherBody) {
    this.validateUpdateBody(body);

    const existing = await this.prisma.voucher.findUnique({
      where: { VoucherID: voucherId },
      select: { VoucherID: true },
    });
    if (!existing) {
      throw new NotFoundException('Voucher not found');
    }

    const expiry = new Date(body.ExpiryDate);
    if (Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('Invalid ExpiryDate');
    }

    try {
      const updated = await this.prisma.voucher.update({
        where: { VoucherID: voucherId },
        data: {
          Code: String(body.Code).trim(),
          ExpiryDate: expiry,
          DiscountPercent:
            body.DiscountPercent != null ? new Prisma.Decimal(body.DiscountPercent) : null,
          DiscountAmount:
            body.DiscountAmount != null ? new Prisma.Decimal(body.DiscountAmount) : null,
          MinOrderValue:
            body.MinOrderValue != null && `${body.MinOrderValue}` !== ''
              ? new Prisma.Decimal(body.MinOrderValue)
              : null,
          MaxUsage:
            body.MaxUsage != null && `${body.MaxUsage}` !== '' ? Number(body.MaxUsage) : null,
        },
      });

      await this.vouchersService.invalidateApprovedListCache();
      return { success: true as const, voucher: updated };
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
      throw err;
    }
  }
}
