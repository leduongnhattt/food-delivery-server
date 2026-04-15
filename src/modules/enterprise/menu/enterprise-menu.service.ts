import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

export interface CreateMenuDto {
  MenuName: string;
  Description?: string;
}

export interface UpdateMenuDto {
  MenuID: string;
  MenuName: string;
  Description?: string;
}

@Injectable()
export class EnterpriseMenuService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new BadRequestException('Enterprise profile not found');
    return enterprise.EnterpriseID;
  }

  async listByEnterpriseId(enterpriseId: string) {
    if (!enterpriseId) {
      throw new BadRequestException('Enterprise ID is required');
    }
    const menus = await this.prisma.menu.findMany({
      where: { EnterpriseID: enterpriseId },
      select: { MenuID: true, MenuName: true, Description: true },
      orderBy: { MenuName: 'asc' },
    });
    return { menus };
  }

  async create(accountId: string, dto: CreateMenuDto) {
    if (!dto.MenuName) {
      throw new BadRequestException('Menu name is required');
    }
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const menu = await this.prisma.menu.create({
      data: { MenuName: dto.MenuName, Description: dto.Description, EnterpriseID: enterpriseId },
    });
    return { menu };
  }

  async update(accountId: string, dto: UpdateMenuDto) {
    if (!dto.MenuID) throw new BadRequestException('Menu ID is required');
    if (!dto.MenuName) throw new BadRequestException('Menu name is required');

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const existing = await this.prisma.menu.findUnique({ where: { MenuID: dto.MenuID } });
    if (!existing || existing.EnterpriseID !== enterpriseId) {
      throw new BadRequestException('Menu not found');
    }
    const menu = await this.prisma.menu.update({
      where: { MenuID: dto.MenuID },
      data: { MenuName: dto.MenuName, Description: dto.Description },
    });
    return { menu };
  }

  async remove(accountId: string, menuId: string) {
    if (!menuId) throw new BadRequestException('Menu ID is required');

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const existing = await this.prisma.menu.findUnique({ where: { MenuID: menuId } });
    if (!existing || existing.EnterpriseID !== enterpriseId) {
      throw new BadRequestException('Menu not found');
    }
    await this.prisma.menu.delete({ where: { MenuID: menuId } });
    return { success: true };
  }
}

