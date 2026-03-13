import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express/multer';
import type { Request } from 'express';
import { AuthService, type JwtPayload } from '@modules/auth/auth.service';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import { ReviewsService } from '@modules/reviews/reviews.service';

type UploadedImageFile = {
  buffer?: Buffer;
  mimetype?: string;
  size?: number;
};

interface RequestWithFiles extends Request {
  files?: {
    images?: UploadedImageFile[];
  };
}

@Controller()
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly authService: AuthService,
  ) {}

  @Post('reviews')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'images', maxCount: 6 }]))
  async createReview(
    @Req() req: Request,
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: { enterpriseId?: string; rating?: string; comment?: string },
  ) {
    if (!account || !account.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const accountId = account.accountId;
    const { files: requestFiles } = req as RequestWithFiles;
    const files = requestFiles?.images;
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
  @UseGuards(JwtAuthGuard)
  async getEnterpriseReviews(
    @Req() req: Request,
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
    if (!account || !account.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const accountId = account.accountId;
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
  @UseGuards(JwtAuthGuard)
  async patchEnterpriseReview(
    @Req() req: Request,
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { isHidden?: boolean },
  ) {
    if (!account || !account.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const accountId = account.accountId;
    if (typeof body.isHidden !== 'boolean') {
      throw new BadRequestException(
        'Invalid payload: isHidden must be a boolean',
      );
    }
    return this.reviewsService.patchEnterpriseReview(
      accountId,
      id,
      body.isHidden,
    );
  }

  @Get('admin/reviews')
  @UseGuards(JwtAuthGuard)
  async getAdminReviews(
    @Req() req: Request,
    @CurrentAccount() account: JwtPayload | null,
    @Query('q') q?: string,
    @Query('enterpriseId') enterpriseId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!account || !account.accountId) {
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

  @Patch('admin/reviews/:id')
  @UseGuards(JwtAuthGuard)
  async patchAdminReview(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { isHidden?: boolean },
  ) {
    if (!account || !account.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    if (typeof body.isHidden !== 'boolean') {
      throw new BadRequestException('isHidden must be a boolean');
    }
    return this.reviewsService.patchAdminReview(id, body.isHidden);
  }
}
