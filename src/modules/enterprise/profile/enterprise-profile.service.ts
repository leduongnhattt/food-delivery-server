import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { Prisma } from '@prisma/client';

export type EnterpriseProfileInclude = 'menus' | 'foods' | 'vouchers' | null;

export interface UpdateEnterpriseProfileDto {
  EnterpriseName: string;
  Address?: string | null;
  PhoneNumber?: string | null;
  Description?: string | null;
  OpenHours?: string | null;
  CloseHours?: string | null;
}

@Injectable()
export class EnterpriseProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(accountId: string, include: EnterpriseProfileInclude) {
    const baseSelect = {
      EnterpriseID: true,
      EnterpriseName: true,
      Address: true,
      PhoneNumber: true,
      Description: true,
      OpenHours: true,
      CloseHours: true,
      account: {
        select: {
          Email: true,
          Avatar: true,
        },
      },
    } satisfies Prisma.EnterpriseSelect;

    const select: Prisma.EnterpriseSelect = { ...baseSelect };

    if (include === 'menus') {
      select.menus = {
        select: {
          MenuID: true,
          MenuName: true,
          Description: true,
        },
        orderBy: { MenuName: 'asc' },
      } satisfies Prisma.MenuFindManyArgs;
    } else if (include === 'foods') {
      select.foods = {
        select: {
          FoodID: true,
          DishName: true,
          Description: true,
          Price: true,
          ImageURL: true,
          Stock: true,
          IsAvailable: true,
          foodCategory: {
            select: {
              CategoryID: true,
              CategoryName: true,
            },
          },
        },
      } satisfies Prisma.FoodFindManyArgs;
    } else if (include === 'vouchers') {
      select.vouchers = {
        select: {
          VoucherID: true,
          Code: true,
          DiscountPercent: true,
          ExpiryDate: true,
          Status: true,
        },
        orderBy: { ExpiryDate: 'asc' },
      } satisfies Prisma.VoucherFindManyArgs;
    }

    const enterprise = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select,
    });

    if (!enterprise) {
      throw new NotFoundException('Enterprise profile not found');
    }

    return { enterprise };
  }

  async updateProfile(accountId: string, dto: UpdateEnterpriseProfileDto) {
    const name = dto.EnterpriseName?.trim();
    if (!name) {
      throw new BadRequestException('Enterprise name is required');
    }

    const exists = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select: { EnterpriseID: true },
    });
    if (!exists) {
      throw new NotFoundException('Enterprise profile not found');
    }

    const enterprise = await this.prisma.enterprise.update({
      where: { AccountID: accountId },
      data: {
        EnterpriseName: name,
        Address: dto.Address?.trim() || undefined,
        PhoneNumber: dto.PhoneNumber?.trim() || undefined,
        Description: dto.Description?.trim() || undefined,
        OpenHours: dto.OpenHours?.trim() || undefined,
        CloseHours: dto.CloseHours?.trim() || undefined,
        UpdatedAt: new Date(),
      },
      select: {
        EnterpriseID: true,
        EnterpriseName: true,
        Address: true,
        PhoneNumber: true,
        Description: true,
        OpenHours: true,
        CloseHours: true,
        account: {
          select: {
            Email: true,
            Avatar: true,
          },
        },
      },
    });

    return {
      message: 'Enterprise profile updated successfully',
      enterprise,
    };
  }
}

