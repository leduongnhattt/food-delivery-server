import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from '@infra/repositories/auth.repository';
import { ReviewsRepository } from '@infra/repositories/reviews.repository';
import { uploadBufferToCloudinary } from '@infra/cloudinary/cloudinary.service';

const COMMENT_MAX_LENGTH = 100; // matches DB VarChar(100)
const MAX_IMAGES = 6;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface CreateReviewInput {
  enterpriseId: string;
  rating?: number | null;
  comment?: string | null;
  imageUrls?: string[];
}

export interface CreateReviewResult {
  success: boolean;
  review: {
    id: string;
    author: string;
    rating: number;
    content: string;
    images: string[];
    createdAt: string;
  };
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewsRepo: ReviewsRepository,
    private readonly authRepo: AuthRepository,
  ) {}

  async createReview(
    accountId: string,
    input: CreateReviewInput,
    imageBuffers?: Array<{ buffer: Buffer; mimeType: string }>,
  ): Promise<CreateReviewResult> {
    const customerId = await this.reviewsRepo.getCustomerIdByAccountId(accountId);
    if (!customerId) {
      throw new UnauthorizedException('Customer profile not found');
    }

    const { enterpriseId, rating, comment } = input;
    if (!enterpriseId) {
      throw new BadRequestException('Enterprise ID is required');
    }

    const ratingNum = rating != null ? Number(rating) : null;
    if (ratingNum != null && (ratingNum < 1 || ratingNum > 5)) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const trimmedComment = comment?.trim() ?? '';
    if (!ratingNum && !trimmedComment && (!imageBuffers?.length) && (!input.imageUrls?.length)) {
      throw new BadRequestException('At least rating, comment, or image is required');
    }
    if (trimmedComment.length > COMMENT_MAX_LENGTH) {
      throw new BadRequestException(`Comment must be ${COMMENT_MAX_LENGTH} characters or less`);
    }
    const totalImages = (imageBuffers?.length ?? 0) + (input.imageUrls?.length ?? 0);
    if (totalImages > MAX_IMAGES) {
      throw new BadRequestException('Maximum 6 images allowed');
    }

    const imageUrls: string[] = [...(input.imageUrls ?? [])];
    if (imageBuffers?.length) {
      const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || 'reviews';
      for (const { buffer, mimeType } of imageBuffers) {
        const url = await uploadBufferToCloudinary(buffer, mimeType, {
          folder,
          maxBytes: 5 * 1024 * 1024,
        });
        imageUrls.push(url);
      }
    }

    const review = await this.reviewsRepo.create({
      CustomerID: customerId,
      EnterpriseID: enterpriseId,
      Rating: ratingNum,
      Comment: trimmedComment || null,
      Images: imageUrls.length > 0 ? imageUrls : undefined,
    });

    const author =
      (review as { customer?: { account?: { Username?: string | null } } })?.customer?.account
        ?.Username ?? 'Anonymous';

    return {
      success: true,
      review: {
        id: review.ReviewID,
        author,
        rating: review.Rating ?? 0,
        content: review.Comment ?? '',
        images: Array.isArray(review.Images) ? (review.Images as string[]) : [],
        createdAt: review.CreatedAt.toISOString(),
      },
    };
  }

  async getEnterpriseReviews(
    accountId: string,
    criteria: {
      q?: string;
      rating?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      sort?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const enterpriseId = await this.reviewsRepo.getEnterpriseIdByAccountId(accountId);
    if (!enterpriseId) {
      throw new UnauthorizedException('Enterprise not found');
    }

    const page = Math.max(1, criteria.page ?? 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, criteria.limit ?? DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * limit;
    const sort = criteria.sort === 'oldest' ? 'asc' : 'desc';

    const where = this.reviewsRepo.buildWhereForEnterprise(enterpriseId, {
      q: criteria.q?.trim(),
      rating: criteria.rating ? parseInt(criteria.rating, 10) : undefined,
      status: (criteria.status as 'all' | 'active' | 'hidden') || 'all',
      startDate: criteria.startDate,
      endDate: criteria.endDate,
      sort,
    });

    const [reviews, total, stats, counts] = await Promise.all([
      this.reviewsRepo.findManyForEnterprise(where, { CreatedAt: sort }, skip, limit),
      this.reviewsRepo.countForEnterprise(where),
      this.reviewsRepo.getAverageAndCount(enterpriseId, true),
      this.reviewsRepo.getHiddenAndVisibleCount(enterpriseId),
    ]);

    const formatted = reviews.map((r) => ({
      id: r.ReviewID,
      customerName: (r.customer as { account?: { Username?: string; Email?: string } })?.account?.Username ?? 'Anonymous',
      customerEmail: (r.customer as { account?: { Email?: string } })?.account?.Email ?? null,
      rating: r.Rating ?? 0,
      comment: r.Comment ?? '',
      createdAt: r.CreatedAt.toISOString(),
      updatedAt: r.UpdatedAt?.toISOString() ?? null,
      images: Array.isArray(r.Images) ? (r.Images as string[]) : [],
      isHidden: r.IsHidden,
    }));

    return {
      success: true,
      reviews: formatted,
      stats: {
        averageRating: Math.round(stats.averageRating * 10) / 10,
        totalReviews: stats.totalReviews,
        ratingDistribution: stats.ratingDistribution,
        visibleCount: counts.visible,
        hiddenCount: counts.hidden,
        supportsVisibility: true,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      features: { visibilityToggle: true },
    };
  }

  async patchEnterpriseReview(
    accountId: string,
    reviewId: string,
    isHidden: boolean,
  ) {
    const enterpriseId = await this.reviewsRepo.getEnterpriseIdByAccountId(accountId);
    if (!enterpriseId) {
      throw new UnauthorizedException('Enterprise not found');
    }

    const existing = await this.reviewsRepo.findUnique(reviewId);
    if (!existing || existing.EnterpriseID !== enterpriseId) {
      throw new NotFoundException('Review not found');
    }

    const updated = await this.reviewsRepo.updateIsHidden(reviewId, isHidden);
    return {
      success: true,
      reviewId: updated.ReviewID,
      isHidden: updated.IsHidden,
    };
  }

  async getAdminReviews(criteria: {
    q?: string;
    enterpriseId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where = this.reviewsRepo.buildWhereForAdmin({
      q: criteria.q?.trim(),
      enterpriseId: criteria.enterpriseId || undefined,
      status: (criteria.status as 'all' | 'active' | 'hidden') || 'all',
      startDate: criteria.startDate,
      endDate: criteria.endDate,
    });

    const reviews = await this.reviewsRepo.findManyForAdmin(where, 100);
    const formatted = reviews.map((r) => ({
      id: r.ReviewID,
      customerName: (r.customer as { account?: { Username?: string } })?.account?.Username ?? 'Anonymous',
      customerEmail: (r.customer as { account?: { Email?: string } })?.account?.Email ?? '',
      enterpriseId: (r.enterprise as { EnterpriseID?: string })?.EnterpriseID ?? '',
      enterpriseName: (r.enterprise as { EnterpriseName?: string })?.EnterpriseName ?? '',
      rating: r.Rating ?? 0,
      comment: r.Comment ?? '',
      images: Array.isArray(r.Images) ? (r.Images as string[]) : [],
      createdAt: r.CreatedAt.toISOString(),
      updatedAt: r.UpdatedAt?.toISOString() ?? null,
      isHidden: r.IsHidden,
    }));

    return { reviews: formatted, total: formatted.length };
  }

  async patchAdminReview(reviewId: string, isHidden: boolean) {
    const existing = await this.reviewsRepo.findUnique(reviewId);
    if (!existing) {
      throw new NotFoundException('Review not found');
    }
    const updated = await this.reviewsRepo.updateIsHidden(reviewId, isHidden);
    return {
      success: true,
      review: { id: updated.ReviewID, isHidden: updated.IsHidden },
    };
  }
}
