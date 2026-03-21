import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { ReviewsService } from '@modules/reviews/reviews.service';

@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getList(
    @CurrentAccount() account: JwtPayload | null,
    @Query('q') q?: string,
    @Query('enterpriseId') enterpriseId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.reviewsService.getAdminReviews({
      q,
      enterpriseId,
      status,
      startDate,
      endDate,
    });
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  patch(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { isHidden?: boolean },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    if (typeof body.isHidden !== 'boolean') {
      throw new BadRequestException('isHidden must be a boolean');
    }
    return this.reviewsService.patchAdminReview(id, body.isHidden);
  }
}
