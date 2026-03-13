import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

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

  async updateProfile(
    accountId: string,
    params: { fullName?: string; phone?: string; address?: string },
  ): Promise<CustomerDto | null> {
    if (!accountId) {
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
