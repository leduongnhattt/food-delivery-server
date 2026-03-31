import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class EnterpriseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const categories = await this.prisma.foodCategory.findMany({
      select: {
        CategoryID: true,
        CategoryName: true,
        Description: true,
      },
      orderBy: { CategoryName: 'asc' },
    });

    return { categories };
  }
}

