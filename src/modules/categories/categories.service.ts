import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: { enterpriseId?: string | undefined }) {
    const { enterpriseId } = params;

    const categories = await this.prisma.foodCategory.findMany({
      select: {
        CategoryID: true,
        CategoryName: true,
        Description: true,
        CreatedAt: true,
        _count: {
          select: {
            foods: {
              where: {
                IsAvailable: true,
                ...(enterpriseId ? { EnterpriseID: enterpriseId } : {}),
              },
            },
          },
        },
      },
      orderBy: { CategoryName: 'asc' },
    });

    return {
      categories: categories.map((cat) => ({
        id: cat.CategoryID,
        name: cat.CategoryName,
        description: cat.Description || '',
        foodCount: cat._count.foods,
        createdAt: cat.CreatedAt
          ? cat.CreatedAt.toISOString()
          : new Date().toISOString(),
      })),
      total: categories.length,
    };
  }

  async create(params: {
    accountId: string;
    categoryName: string;
    description?: string | null;
  }) {
    const { accountId, categoryName, description } = params;
    if (!categoryName?.trim()) {
      throw new BadRequestException('Category name is required');
    }

    const admin = await this.prisma.admin.findUnique({
      where: { AccountID: accountId },
      select: { AdminID: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin profile not found');
    }

    const existing = await this.prisma.foodCategory.findFirst({
      where: { CategoryName: categoryName },
      select: { CategoryID: true },
    });
    if (existing) {
      throw new BadRequestException('Category with this name already exists');
    }

    const newCategory = await this.prisma.foodCategory.create({
      data: {
        CategoryName: categoryName,
        Description: description || null,
        AdminID: admin.AdminID,
      },
      select: {
        CategoryID: true,
        CategoryName: true,
        Description: true,
        CreatedAt: true,
      },
    });

    return {
      success: true,
      message: 'Category created successfully',
      category: newCategory,
    };
  }
}

