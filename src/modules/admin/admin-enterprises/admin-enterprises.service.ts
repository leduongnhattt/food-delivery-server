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
  latitude: number;
  longitude: number;
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
      latitude,
      longitude,
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
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !openHours?.trim() ||
      !closeHours?.trim()
    ) {
      throw new BadRequestException('Missing required fields');
    }
    if (latitude < -90 || latitude > 90) {
      throw new BadRequestException('Latitude is out of range');
    }
    if (longitude < -180 || longitude > 180) {
      throw new BadRequestException('Longitude is out of range');
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
        latitude: body.latitude,
        longitude: body.longitude,
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

  private maskAccountTail(accountNumber: string | null | undefined): string {
    const s = (accountNumber ?? '').replace(/\s+/g, '');
    if (!s) return '—';
    const tail = s.slice(-4);
    return tail.length ? `****${tail}` : '—';
  }

  /**
   * Admin detail view: enterprise profile, payout hints, aggregates, and linked foods.
   */
  async getEnterpriseDetail(enterpriseId: string) {
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { EnterpriseID: enterpriseId, DeletedAt: null },
      include: {
        account: {
          select: {
            AccountID: true,
            Email: true,
            Username: true,
            Status: true,
            CreatedAt: true,
          },
        },
        payoutSettings: {
          include: {
            preferredDestination: true,
          },
        },
        payoutDestinations: {
          where: { IsActive: true },
          orderBy: [{ IsDefault: 'desc' }, { CreatedAt: 'desc' }],
          take: 5,
        },
      },
    });

    if (!enterprise) {
      throw new NotFoundException('Enterprise not found');
    }

    const pendingInvitation = await this.prisma.enterpriseInvitation.findFirst({
      where: {
        AccountID: enterprise.account.AccountID,
        Status: 'Pending',
      },
      select: { InvitationID: true },
    });
    const hasPendingInvitation = !!pendingInvitation;

    const preferred =
      enterprise.payoutSettings?.preferredDestination ??
      enterprise.payoutDestinations.find((d) => d.IsDefault) ??
      enterprise.payoutDestinations[0];

    const bankAccountMasked = preferred
      ? preferred.Kind === 'BankAccount'
        ? this.maskAccountTail(preferred.AccountNumber)
        : preferred.WalletDisplayName || preferred.WalletRef || '—'
      : '—';

    const payoutMethod = preferred ? String(preferred.Kind) : '—';

    const [
      productCount,
      revenueAgg,
      orderDistinct,
      reviewAgg,
      refundedOrderGroups,
      cancelledOrderGroups,
      foods,
      categorySample,
    ] = await Promise.all([
      this.prisma.food.count({ where: { EnterpriseID: enterpriseId } }),
      this.prisma.orderDetail.aggregate({
        where: { food: { EnterpriseID: enterpriseId } },
        _sum: { SubTotal: true },
      }),
      this.prisma.orderDetail.groupBy({
        by: ['OrderID'],
        where: { food: { EnterpriseID: enterpriseId } },
      }),
      this.prisma.review.aggregate({
        where: {
          EnterpriseID: enterpriseId,
          IsHidden: false,
          Rating: { not: null },
        },
        _avg: { Rating: true },
        _count: { ReviewID: true },
      }),
      this.prisma.orderDetail.groupBy({
        by: ['OrderID'],
        where: {
          food: { EnterpriseID: enterpriseId },
          order: { Status: 'Refunded' },
        },
      }),
      this.prisma.orderDetail.groupBy({
        by: ['OrderID'],
        where: {
          food: { EnterpriseID: enterpriseId },
          order: { Status: 'Cancelled' },
        },
      }),
      this.prisma.food.findMany({
        where: { EnterpriseID: enterpriseId },
        orderBy: { CreatedAt: 'desc' },
        take: 50,
        select: {
          FoodID: true,
          DishName: true,
          Price: true,
          IsAvailable: true,
          ImageURL: true,
          foodCategory: { select: { CategoryName: true } },
        },
      }),
      this.prisma.food.findFirst({
        where: { EnterpriseID: enterpriseId },
        select: { foodCategory: { select: { CategoryName: true } } },
      }),
    ]);

    const totalOrders = orderDistinct.length;
    const totalRevenue = revenueAgg._sum.SubTotal ?? 0;
    const totalReturns = refundedOrderGroups.length;
    const cancellationRatePercent =
      totalOrders > 0
        ? Math.round((cancelledOrderGroups.length / totalOrders) * 100)
        : 0;
    const satisfactionRatingAvg = reviewAgg._avg.Rating;
    const reviewCount = reviewAgg._count.ReviewID;

    return {
      enterprise: {
        EnterpriseID: enterprise.EnterpriseID,
        EnterpriseName: enterprise.EnterpriseName,
        PhoneNumber: enterprise.PhoneNumber,
        Address: enterprise.Address,
        OpenHours: enterprise.OpenHours,
        CloseHours: enterprise.CloseHours,
        Description: enterprise.Description,
        Latitude: enterprise.Latitude,
        Longitude: enterprise.Longitude,
        CreatedAt: enterprise.CreatedAt,
        account: enterprise.account,
      },
      business: {
        legalBusinessName: null as string | null,
        registrationNumber: null as string | null,
        taxId: null as string | null,
        bankAccountMasked,
        payoutMethod,
      },
      stats: {
        totalProducts: productCount,
        totalRevenue,
        totalOrders,
        totalReturns,
        cancellationRatePercent,
        satisfactionRatingAvg,
        reviewCount,
      },
      linkedProducts: foods.map((f) => ({
        FoodID: f.FoodID,
        DishName: f.DishName,
        Price: f.Price,
        IsAvailable: f.IsAvailable,
        ImageURL: f.ImageURL,
        CategoryName: f.foodCategory?.CategoryName ?? null,
      })),
      primaryCategoryName: categorySample?.foodCategory?.CategoryName ?? null,
      hasPendingInvitation,
    };
  }
}
