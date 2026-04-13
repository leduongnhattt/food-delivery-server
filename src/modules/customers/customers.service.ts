import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { placeholderPhoneFromAccountId } from '@infra/repositories/auth.repository';

export interface CustomerDto {
  CustomerID: string;
  AccountID: string;
  FullName: string | null;
  PhoneNumber: string | null;
  Address: string | null;
  DateOfBirth: Date | null;
  Gender: string | null;
  PreferredPaymentMethod: string | null;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async getByAccountId(accountId: string): Promise<CustomerDto | null> {
    if (!accountId) {
      return null;
    }
    const customer = await this.prisma.customer.findUnique({
      where: { AccountID: accountId },
      select: {
        CustomerID: true,
        AccountID: true,
        FullName: true,
        PhoneNumber: true,
        Address: true,
        DateOfBirth: true,
        Gender: true,
        PreferredPaymentMethod: true,
      },
    });
    return customer ?? null;
  }

  /**
   * If Account has role Customer but no CUSTOMER row (e.g. failed signup insert), create the missing row.
   */
  async ensureCustomerRowForAccount(accountId: string): Promise<CustomerDto | null> {
    if (!accountId) {
      return null;
    }
    const existing = await this.getByAccountId(accountId);
    if (existing) {
      return existing;
    }
    const account = await this.prisma.account.findUnique({
      where: { AccountID: accountId },
      include: { role: true },
    });
    if (!account?.role || account.role.RoleName !== 'Customer') {
      return null;
    }
    const phone = placeholderPhoneFromAccountId(accountId);
    return this.prisma.customer.create({
      data: {
        AccountID: accountId,
        FullName: account.Username,
        PhoneNumber: phone,
        Address: 'Default Address',
        PreferredPaymentMethod: PaymentMethod.Cash,
      },
      select: {
        CustomerID: true,
        AccountID: true,
        FullName: true,
        PhoneNumber: true,
        Address: true,
        DateOfBirth: true,
        Gender: true,
        PreferredPaymentMethod: true,
      },
    });
  }

  async updateProfile(
    accountId: string,
    params: { fullName?: string; phone?: string; address?: string },
  ): Promise<CustomerDto | null> {
    if (!accountId) {
      return null;
    }
    const ensured = await this.ensureCustomerRowForAccount(accountId);
    if (!ensured) {
      return null;
    }
    const updated = await this.prisma.customer.update({
      where: { AccountID: accountId },
      data: {
        FullName: params.fullName ?? undefined,
        PhoneNumber: params.phone ?? undefined,
        Address: params.address ?? undefined,
      },
      select: {
        CustomerID: true,
        AccountID: true,
        FullName: true,
        PhoneNumber: true,
        Address: true,
        DateOfBirth: true,
        Gender: true,
        PreferredPaymentMethod: true,
      },
    });
    return updated;
  }
}
