import {
  BadRequestException,
  Body,
  Controller,
  Post,
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

}
