import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { AuthService } from '@modules/auth/auth.service';

export type AdminEnterpriseListStatus = 'all' | 'active' | 'locked';

export interface CreateEnterpriseBody {
  username: string;
  email: string;
  password: string;
  enterpriseName: string;
  phoneNumber: string;
  address: string;
  openHours: string;
  closeHours: string;
  description?: string;
}

@Injectable()
export class AdminEnterprisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  private buildWhere(
    statusParam: AdminEnterpriseListStatus,
    search: string,
  ): Prisma.EnterpriseWhereInput {
    const where: Prisma.EnterpriseWhereInput = {};
    if (statusParam === 'active') {
      where.account = { is: { Status: AccountStatus.Active } };
    } else if (statusParam === 'locked') {
      where.account = { is: { Status: AccountStatus.Inactive } };
    }
    const q = search.trim();
    if (q) {
      where.OR = [
        { EnterpriseName: { contains: q } },
        { PhoneNumber: { contains: q } },
        { account: { is: { Email: { contains: q } } } },
      ];
    }
    return where;
  }

  async listEnterprises(params: {
    status: AdminEnterpriseListStatus;
    search: string;
  }) {
    const where = this.buildWhere(params.status, params.search);
    const items = await this.prisma.enterprise.findMany({
      where,
      orderBy: { CreatedAt: 'desc' },
      select: {
        EnterpriseID: true,
        EnterpriseName: true,
        PhoneNumber: true,
        Address: true,
        OpenHours: true,
        CloseHours: true,
        CreatedAt: true,
        account: {
          select: { AccountID: true, Email: true, Status: true },
        },
      },
    });
    return { items };
  }

  parseListQuery(statusRaw?: string, searchRaw?: string | null): {
    status: AdminEnterpriseListStatus;
    search: string;
  } {
    const raw = (statusRaw || 'all').toLowerCase();
    const status: AdminEnterpriseListStatus =
      raw === 'active' || raw === 'locked' ? raw : 'all';
    const search = (searchRaw ?? '').trim();
    return { status, search };
  }

  validateCreateBody(body: CreateEnterpriseBody): void {
    const {
      username,
      email,
      password,
      enterpriseName,
      phoneNumber,
      address,
      openHours,
      closeHours,
    } = body;
    if (
      !username?.trim() ||
      !email?.trim() ||
      !password ||
      !enterpriseName?.trim() ||
      !phoneNumber?.trim() ||
      !address?.trim() ||
      !openHours?.trim() ||
      !closeHours?.trim()
    ) {
      throw new BadRequestException('Missing required fields');
    }
  }

  async createEnterprise(body: CreateEnterpriseBody) {
    this.validateCreateBody(body);
    try {
      const { enterprise } = await this.authService.createAccountForEnterprise({
        username: body.username.trim(),
        email: body.email.trim(),
        password: body.password,
        enterpriseName: body.enterpriseName.trim(),
        address: body.address.trim(),
        phoneNumber: body.phoneNumber.trim(),
        description: body.description?.trim(),
        openHours: body.openHours.trim(),
        closeHours: body.closeHours.trim(),
      });
      return { success: true as const, enterprise };
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Username, email, or phone number already in use.',
        );
      }
      if (err instanceof Error && err.message === 'Enterprise role not found') {
        throw new InternalServerErrorException(err.message);
      }
      throw err;
    }
  }

  /**
   * Locks the account tied to an enterprise (admin UI uses AccountID from list payload).
   */
  async lockEnterpriseAccount(accountId: string): Promise<{ success: true }> {
    const row = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select: { EnterpriseID: true },
    });
    if (!row) {
      throw new NotFoundException('Enterprise account not found');
    }
    await this.prisma.account.update({
      where: { AccountID: accountId },
      data: { Status: AccountStatus.Inactive },
    });
    return { success: true };
  }

  async unlockEnterpriseAccount(accountId: string): Promise<{ success: true }> {
    const row = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select: { EnterpriseID: true },
    });
    if (!row) {
      throw new NotFoundException('Enterprise account not found');
    }
    await this.prisma.account.update({
      where: { AccountID: accountId },
      data: { Status: AccountStatus.Active },
    });
    return { success: true };
  }
}
