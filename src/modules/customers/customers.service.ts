import { Injectable } from '@nestjs/common';
import { Gender, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { placeholderPhoneFromAccountId } from '@infra/repositories/auth.repository';

export interface CustomerDto {
  CustomerID: string;
  AccountID: string;
  FullName: string | null;
  PhoneNumber: string | null;
  Address: string | null;
  Latitude: Prisma.Decimal | null;
  Longitude: Prisma.Decimal | null;
  LocationUpdatedAt: Date | null;
  DateOfBirth: Date | null;
  Gender: string | null;
  PreferredPaymentMethod: string | null;
}

/** Row shape from Prisma `customer` select including geo + payment enum. */
type CustomerSelectedRow = {
  CustomerID: string;
  AccountID: string;
  FullName: string | null;
  PhoneNumber: string | null;
  Address: string | null;
  Latitude: Prisma.Decimal | null;
  Longitude: Prisma.Decimal | null;
  LocationUpdatedAt: Date | null;
  DateOfBirth: Date | null;
  Gender: Gender | null;
  PreferredPaymentMethod: PaymentMethod;
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private mapCustomerRow(row: CustomerSelectedRow): CustomerDto {
    return {
      CustomerID: row.CustomerID,
      AccountID: row.AccountID,
      FullName: row.FullName,
      PhoneNumber: row.PhoneNumber,
      Address: row.Address,
      Latitude: row.Latitude,
      Longitude: row.Longitude,
      LocationUpdatedAt: row.LocationUpdatedAt,
      DateOfBirth: row.DateOfBirth,
      Gender: row.Gender,
      PreferredPaymentMethod: String(row.PreferredPaymentMethod ?? ''),
    };
  }

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
        Latitude: true,
        Longitude: true,
        LocationUpdatedAt: true,
        DateOfBirth: true,
        Gender: true,
        PreferredPaymentMethod: true,
      },
    });
    return customer ? this.mapCustomerRow(customer) : null;
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
    const customer = await this.prisma.customer.create({
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
        Latitude: true,
        Longitude: true,
        LocationUpdatedAt: true,
        DateOfBirth: true,
        Gender: true,
        PreferredPaymentMethod: true,
      },
    });
    return this.mapCustomerRow(customer);
  }

  async updateProfile(
    accountId: string,
    params: { fullName?: string; phone?: string; address?: string; lat?: number; lng?: number },
  ): Promise<CustomerDto | null> {
    if (!accountId) {
      return null;
    }
    const ensured = await this.ensureCustomerRowForAccount(accountId);
    if (!ensured) {
      return null;
    }
    const hasLatLng = Number.isFinite(params.lat) && Number.isFinite(params.lng);
    const updated = await this.prisma.customer.update({
      where: { AccountID: accountId },
      data: {
        FullName: params.fullName ?? undefined,
        PhoneNumber: params.phone ?? undefined,
        Address: params.address ?? undefined,
        Latitude: hasLatLng ? params.lat : undefined,
        Longitude: hasLatLng ? params.lng : undefined,
        LocationUpdatedAt: hasLatLng ? new Date() : undefined,
      },
      select: {
        CustomerID: true,
        AccountID: true,
        FullName: true,
        PhoneNumber: true,
        Address: true,
        Latitude: true,
        Longitude: true,
        LocationUpdatedAt: true,
        DateOfBirth: true,
        Gender: true,
        PreferredPaymentMethod: true,
      },
    });
    return this.mapCustomerRow(updated);
  }
}
