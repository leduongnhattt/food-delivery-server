import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { VouchersService } from '@modules/vouchers/vouchers.service';

export interface CreateEnterpriseVoucherDto {
  Code: string;
  ExpiryDate: string;
  DiscountPercent?: number | null;
  DiscountAmount?: number | null;
  MinOrderValue?: number | null;
  MaxUsage?: number | null;
}

export interface UpdateEnterpriseVoucherDto extends CreateEnterpriseVoucherDto {
  VoucherID: string;
}

@Injectable()
export class EnterpriseVoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vouchersService: VouchersService,
  ) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new NotFoundException('Enterprise profile not found');
    return enterprise.EnterpriseID;
  }

  private async invalidateIfApproved(status: string | null | undefined) {
    if (status === 'Approved') {
      await this.vouchersService.invalidateApprovedListCache();
    }
  }

  async create(accountId: string, dto: CreateEnterpriseVoucherDto) {
    if (!dto.Code) throw new BadRequestException('Coupon Code is required');
    if (!dto.ExpiryDate) throw new BadRequestException('Expiry Date is required');
    if (!dto.DiscountPercent && !dto.DiscountAmount) {
      throw new BadRequestException(
        'Either Discount Percent or Discount Amount is required',
      );
    }

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const voucher = await this.prisma.voucher.create({
      data: {
        Code: dto.Code,
        ExpiryDate: new Date(dto.ExpiryDate),
        DiscountPercent: dto.DiscountPercent || null,
        DiscountAmount: dto.DiscountAmount || null,
        MinOrderValue: dto.MinOrderValue || null,
        MaxUsage: dto.MaxUsage || null,
        CreatedBy: 'Business',
        EnterpriseID: enterpriseId,
      },
    });

    await this.invalidateIfApproved(voucher.Status);
    return { voucher };
  }

  async update(accountId: string, dto: UpdateEnterpriseVoucherDto) {
    if (!dto.VoucherID) throw new BadRequestException('Voucher ID is required');
    if (!dto.Code) throw new BadRequestException('Coupon Code is required');
    if (!dto.ExpiryDate) throw new BadRequestException('Expiry Date is required');
    if (!dto.DiscountPercent && !dto.DiscountAmount) {
      throw new BadRequestException(
        'Either Discount Percent or Discount Amount is required',
      );
    }
    if (dto.DiscountPercent && (dto.DiscountPercent < 1 || dto.DiscountPercent > 100)) {
      throw new BadRequestException('Discount percentage must be between 1 and 100');
    }
    if (dto.DiscountAmount && dto.DiscountAmount <= 0) {
      throw new BadRequestException('Discount amount must be greater than 0');
    }

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const existingVoucher = await this.prisma.voucher.findFirst({
      where: {
        VoucherID: dto.VoucherID,
        EnterpriseID: enterpriseId,
      },
      select: { VoucherID: true },
    });
    if (!existingVoucher) {
      throw new NotFoundException('Voucher not found or access denied');
    }

    const codeExists = await this.prisma.voucher.findFirst({
      where: {
        Code: dto.Code,
        EnterpriseID: enterpriseId,
        VoucherID: { not: dto.VoucherID },
      },
      select: { VoucherID: true },
    });
    if (codeExists) {
      throw new BadRequestException('Voucher code already exists');
    }

    const voucher = await this.prisma.voucher.update({
      where: { VoucherID: dto.VoucherID },
      data: {
        Code: dto.Code,
        ExpiryDate: new Date(dto.ExpiryDate),
        DiscountPercent: dto.DiscountPercent || null,
        DiscountAmount: dto.DiscountAmount || null,
        MinOrderValue: dto.MinOrderValue || null,
        MaxUsage: dto.MaxUsage || null,
      },
    });

    await this.invalidateIfApproved(voucher.Status);
    return { voucher };
  }

  async remove(accountId: string, voucherId: string) {
    if (!voucherId) throw new BadRequestException('Voucher ID is required');
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const existingVoucher = await this.prisma.voucher.findFirst({
      where: { VoucherID: voucherId, EnterpriseID: enterpriseId },
      select: { VoucherID: true },
    });
    if (!existingVoucher) {
      throw new NotFoundException('Voucher not found or access denied');
    }

    const deleted = await this.prisma.voucher.delete({
      where: { VoucherID: voucherId },
    });
    await this.invalidateIfApproved(deleted.Status);
    return { message: 'Voucher deleted successfully' };
  }
}

