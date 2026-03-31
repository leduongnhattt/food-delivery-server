import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { ReviewsService } from '@modules/reviews/reviews.service';

@Controller('enterprise/reviews')
export class EnterpriseReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentAccount() account: JwtPayload | null,
    @Query('q') q?: string,
    @Query('rating') rating?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('sort') sort?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.reviewsService.getEnterpriseReviews(account.accountId, {
      q,
      rating,
      status,
      startDate,
      endDate,
      sort,
      page: pageStr != null ? parseInt(pageStr, 10) : undefined,
      limit: limitStr != null ? parseInt(limitStr, 10) : undefined,
    });
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async patch(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { isHidden?: boolean },
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    if (typeof body.isHidden !== 'boolean') {
      throw new BadRequestException('Invalid payload: isHidden must be a boolean');
    }
    return this.reviewsService.patchEnterpriseReview(
      account.accountId,
      id,
      body.isHidden,
    );
  }

  @Post('request')
  @UseGuards(JwtAuthGuard)
  async requestVisibility(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: { reviewId?: string; action?: 'hide' | 'show'; reason?: string },
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }

    return this.reviewsService.requestEnterpriseReviewVisibility(account.accountId, {
      reviewId: body.reviewId || '',
      action: body.action as 'hide' | 'show',
      reason: body.reason || '',
    });
  }
}

