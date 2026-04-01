import { Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

@Controller('registry')
export class RegistryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async status() {
    const [restaurants, foods, categories] = await Promise.all([
      this.prisma.enterprise.count(),
      this.prisma.food.count(),
      this.prisma.foodCategory.count(),
    ]);
    return {
      success: true,
      message: 'Registry status',
      counts: { restaurants, foods, categories },
    };
  }

  @Post()
  async register() {
    // No-op seed endpoint for compatibility with existing admin UI.
    const [restaurants, foods, categories] = await Promise.all([
      this.prisma.enterprise.count(),
      this.prisma.food.count(),
      this.prisma.foodCategory.count(),
    ]);
    return {
      success: true,
      message: 'Registry updated',
      data: { restaurants, foods, categories },
    };
  }
}

