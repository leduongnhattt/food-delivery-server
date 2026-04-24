import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

export type AdminCustomerListStatus = 'all' | 'active' | 'locked';

@Injectable()
export class AdminCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(
    statusParam: AdminCustomerListStatus,
    search: string,
  ): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = {};
    if (statusParam === 'active') {
      where.account = { is: { Status: AccountStatus.Active } };
    } else if (statusParam === 'locked') {
      where.account = { is: { Status: AccountStatus.Inactive } };
    }
    const q = search.trim();
    if (q) {
      where.OR = [
        { FullName: { contains: q } },
        { PhoneNumber: { contains: q } },
        { account: { is: { Email: { contains: q } } } },
      ];
    }
    return where;
  }

  async listCustomers(params: {
    status: AdminCustomerListStatus;
    search: string;
    take: number;
    cursor?: string;
  }): Promise<{
    items: Array<{
      CustomerID: string;
      FullName: string;
      PhoneNumber: string;
      Address: string;
      account: {
        AccountID: string;
        Email: string;
        Status: AccountStatus;
        CreatedAt: Date;
      };
    }>;
    nextCursor: string | null;
  }> {
    const where = this.buildWhere(params.status, params.search);
    const rows = await this.prisma.customer.findMany({
      where,
      take: params.take + 1,
      ...(params.cursor
        ? { cursor: { CustomerID: params.cursor }, skip: 1 }
        : {}),
      orderBy: { account: { CreatedAt: 'desc' } },
      select: {
        CustomerID: true,
        FullName: true,
        PhoneNumber: true,
        Address: true,
        account: {
          select: {
            AccountID: true,
            Email: true,
            Status: true,
            CreatedAt: true,
          },
        },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > params.take) {
      const next = rows.pop();
      nextCursor = next?.CustomerID ?? null;
    }

    return { items: rows, nextCursor };
  }

  async lockCustomer(customerId: string): Promise<{ success: true }> {
    const cust = await this.prisma.customer.findUnique({
      where: { CustomerID: customerId },
      select: { AccountID: true },
    });
    if (!cust) {
      throw new NotFoundException('Customer not found');
    }
    await this.prisma.account.update({
      where: { AccountID: cust.AccountID },
      data: { Status: AccountStatus.Inactive },
    });
    return { success: true };
  }

  async unlockCustomer(customerId: string): Promise<{ success: true }> {
    const cust = await this.prisma.customer.findUnique({
      where: { CustomerID: customerId },
      select: { AccountID: true },
    });
    if (!cust) {
      throw new NotFoundException('Customer not found');
    }
    await this.prisma.account.update({
      where: { AccountID: cust.AccountID },
      data: { Status: AccountStatus.Active },
    });
    return { success: true };
  }

  parseListQuery(input: {
    statusRaw?: string;
    searchRaw?: string | null;
    limitRaw?: string | null;
    cursorRaw?: string | null;
  }): {
    status: AdminCustomerListStatus;
    search: string;
    take: number;
    cursor?: string;
  } {
    const raw = (input.statusRaw || 'all').toLowerCase();
    const status: AdminCustomerListStatus =
      raw === 'active' || raw === 'locked' ? raw : 'all';
    const search = (input.searchRaw ?? '').trim();
    const take = Math.min(
      Math.max(parseInt(input.limitRaw || '20', 10) || 20, 1),
      100,
    );
    const cursor = input.cursorRaw?.trim() || undefined;
    return { status, search, take, cursor };
  }
}
