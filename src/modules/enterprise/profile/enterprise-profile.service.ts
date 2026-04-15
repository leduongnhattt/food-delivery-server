import {
  BadRequestException,
  ConflictException,
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
  Email?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class EnterpriseProfileService {
  constructor(private readonly prisma: PrismaService) { }

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

    const enterprise = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
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

    const exists = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!exists) {
      throw new NotFoundException('Enterprise profile not found');
    }

    let normalizedEmail: string | undefined;
    if (dto.Email !== undefined && dto.Email !== null) {
      const trimmed = String(dto.Email).trim();
      if (!trimmed) {
        throw new BadRequestException('Email is required');
      }
      if (!EMAIL_RE.test(trimmed)) {
        throw new BadRequestException('Invalid email format');
      }
      normalizedEmail = trimmed.toLowerCase();
    }

    let emailToPersist: string | undefined;
    if (normalizedEmail !== undefined) {
      const current = await this.prisma.account.findUnique({
        where: { AccountID: accountId },
        select: { Email: true },
      });
      if (!current) {
        throw new NotFoundException('Account not found');
      }
      if (current.Email.toLowerCase() !== normalizedEmail) {
        const taken = await this.prisma.account.findFirst({
          where: {
            Email: normalizedEmail,
            NOT: { AccountID: accountId },
          },
          select: { AccountID: true },
        });
        if (taken) {
          throw new ConflictException('Email is already in use');
        }
        emailToPersist = normalizedEmail;
      }
    }

    try {
      const enterprise = await this.prisma.$transaction(async (tx) => {
        if (emailToPersist !== undefined) {
          await tx.account.update({
            where: { AccountID: accountId },
            data: {
              Email: emailToPersist,
              EmailVerified: false,
              UpdatedAt: new Date(),
            },
          });
        }

        return tx.enterprise.update({
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
      });

      return {
        message: 'Enterprise profile updated successfully',
        enterprise,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Email is already in use');
      }
      throw err;
    }
  }
}

