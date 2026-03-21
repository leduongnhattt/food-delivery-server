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

/** Prisma P2002 `meta.target` may be a string, string[], or driver-specific shape — never `String(object)`. */
function prismaUniqueFieldNames(target: unknown): string[] {
  if (target == null) {
    return [];
  }
  if (Array.isArray(target)) {
    return target.map((item) =>
      typeof item === 'string' ? item : JSON.stringify(item),
    );
  }
  if (typeof target === 'string') {
    return [target];
  }
  return [JSON.stringify(target)];
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
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const fields = prismaUniqueFieldNames(err.meta?.target);
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
}
