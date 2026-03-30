import {
  BadRequestException,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';

/**
 * Enterprise cache endpoints.
 *
 * Note: In the current architecture, the enterprise orders caching logic lives in `food-delivery-app`.
 * These endpoints provide a compatible surface on the Nest server so the app can call the server
 * directly after refactoring. Implementation can be extended later to use Redis on the server.
 */
@Controller('enterprise/cache')
export class EnterpriseCacheController {
  @Post('invalidate')
  @UseGuards(JwtAuthGuard)
  async invalidate(
    @CurrentAccount() account: JwtPayload | null,
  ): Promise<{ success: true; message: string }> {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return { success: true, message: 'Cache invalidated' };
  }

  @Get('invalidate')
  @UseGuards(JwtAuthGuard)
  async stats(@CurrentAccount() account: JwtPayload | null) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return { success: true, cacheStats: {}, enterpriseId: null };
  }
}

