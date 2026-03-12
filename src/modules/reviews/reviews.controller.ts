import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express/multer';
import type { Request } from 'express';
import { AuthService } from '@modules/auth/auth.service';
import { ReviewsService } from '@modules/reviews/reviews.service';

function getAccountIdFromRequest(req: Request, authService: AuthService): string | null {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const decoded = authService.verifyAccessToken(token);
  return decoded?.accountId ?? null;
}

function requireAccountId(req: Request, authService: AuthService): string {
  const accountId = getAccountIdFromRequest(req, authService);
  if (!accountId) throw new UnauthorizedException('Unauthorized');
  return accountId;
}

@Controller()
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly authService: AuthService,
  ) {}

  @Post('reviews')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'images', maxCount: 6 }]))
  async createReview(
    @Req() req: Request,
    @Body() body: { enterpriseId?: string; rating?: string; comment?: string },
  ) {
    const accountId = requireAccountId(req, this.authService);
    const files = (req as any).files?.images as Array<{
      buffer?: Buffer;
      mimetype?: string;
      size?: number;
    }> | undefined;
    const imageBuffers = Array.isArray(files)
      ? files
          .filter((f) => f?.buffer && (f.size ?? 0) > 0)
          .map((f) => ({
            buffer: f.buffer as Buffer,
            mimeType: f.mimetype || 'image/jpeg',
          }))
      : undefined;

    const { enterpriseId, rating, comment } = body ?? {};
    if (!enterpriseId) {
      throw new BadRequestException('Enterprise ID is required');
    }

    return this.reviewsService.createReview(
      accountId,
      {
        enterpriseId,
        rating: rating != null ? parseInt(rating, 10) : undefined,
        comment: comment ?? undefined,
      },
      imageBuffers,
    );
  }

  @Get('enterprise/reviews')
  async getEnterpriseReviews(
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('rating') rating?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('sort') sort?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const accountId = requireAccountId(req, this.authService);
    return this.reviewsService.getEnterpriseReviews(accountId, {
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

  @Patch('enterprise/reviews/:id')
  async patchEnterpriseReview(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { isHidden?: boolean },
  ) {
    const accountId = requireAccountId(req, this.authService);
    if (typeof body.isHidden !== 'boolean') {
      throw new BadRequestException('Invalid payload: isHidden must be a boolean');
    }
    return this.reviewsService.patchEnterpriseReview(accountId, id, body.isHidden);
  }

  @Get('admin/reviews')
  async getAdminReviews(
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('enterpriseId') enterpriseId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    requireAccountId(req, this.authService);
    return this.reviewsService.getAdminReviews({
      q,
      enterpriseId,
      status,
      startDate,
      endDate,
    });
  }

  @Patch('admin/reviews/:id')
  async patchAdminReview(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { isHidden?: boolean },
  ) {
    requireAccountId(req, this.authService);
    if (typeof body.isHidden !== 'boolean') {
      throw new BadRequestException('isHidden must be a boolean');
    }
    return this.reviewsService.patchAdminReview(id, body.isHidden);
  }
}
