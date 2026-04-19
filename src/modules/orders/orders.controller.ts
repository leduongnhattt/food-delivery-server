import {
  BadRequestException,
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Query,
  Req,
  Body,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express/multer';
import { UploadedFiles } from '@nestjs/common/decorators';
import {
  OrdersService,
  type CreateOrderRequestDto,
} from '@modules/orders/orders.service';
import { AuthService, type JwtPayload } from '@modules/auth/auth.service';
import {
  ReturnsService,
  type CreateReturnRequestBody,
} from '@modules/orders/returns/returns.service';
import { uploadBufferToCloudinary } from '@infra/cloudinary/cloudinary.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly authService: AuthService,
    private readonly returnsService: ReturnsService,
  ) {}

  private parseJsonField<T>(raw: unknown, fieldName: string): T | undefined {
    if (raw == null) return undefined;
    if (typeof raw !== 'string') return raw as T;
    const s = raw.trim();
    if (!s) return undefined;
    try {
      return JSON.parse(s) as T;
    } catch {
      throw new BadRequestException(`Invalid JSON for ${fieldName}`);
    }
  }

  private pickMultipartBody(
    reqBody: unknown,
  ): Partial<CreateReturnRequestBody> {
    const b =
      reqBody != null && typeof reqBody === 'object' && !Array.isArray(reqBody)
        ? (reqBody as Record<string, unknown>)
        : {};
    return {
      items: this.parseJsonField<CreateReturnRequestBody['items']>(
        b['items'],
        'items',
      ),
      reasonCode:
        typeof b['reasonCode'] === 'string'
          ? (b['reasonCode'] as CreateReturnRequestBody['reasonCode'])
          : undefined,
      reasonText:
        typeof b['reasonText'] === 'string' ? b['reasonText'] : undefined,
      requestedSolution:
        typeof b['requestedSolution'] === 'string'
          ? (b['requestedSolution'] as NonNullable<
              CreateReturnRequestBody['requestedSolution']
            >)
          : undefined,
      metadata: this.parseJsonField<unknown>(b['metadata'], 'metadata'),
    };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: CreateOrderRequestDto) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.createForCustomer(decoded.accountId, body);
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const page = pageStr != null ? parseInt(pageStr, 10) : undefined;
    const limit = limitStr != null ? parseInt(limitStr, 10) : undefined;

    return this.ordersService.listForCustomer(decoded.accountId, {
      status,
      page: Number.isNaN(page) ? undefined : page,
      limit: Number.isNaN(limit) ? undefined : limit,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async getById(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.getByIdForCustomer(decoded.accountId, id);
  }

  @Post(':id/returns')
  @UseInterceptors(FilesInterceptor('evidenceImages', 3))
  async createReturnRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateReturnRequestBody,
    @UploadedFiles()
    evidenceImages?: Array<{ buffer: Buffer; mimetype: string; size: number }>,
  ) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const isMultipart =
      typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type']
            .toLowerCase()
            .includes('multipart/form-data')
        : false;

    const normalizedBody:
      | CreateReturnRequestBody
      | Partial<CreateReturnRequestBody> = isMultipart
      ? this.pickMultipartBody(req.body)
      : body;

    const files = Array.isArray(evidenceImages) ? evidenceImages : [];
    if (files.length > 3) {
      throw new BadRequestException('Too many evidence images (max 3)');
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxBytes = 5 * 1024 * 1024;
    for (const f of files) {
      if (!allowed.includes(f.mimetype)) {
        throw new BadRequestException(
          'Only JPEG, PNG, WEBP, GIF images are allowed',
        );
      }
      if (typeof f.size === 'number' && f.size > maxBytes) {
        throw new BadRequestException('File too large (max 5MB)');
      }
    }

    const uploadedUrls =
      files.length > 0
        ? await Promise.all(
            files.map((f) =>
              uploadBufferToCloudinary(f.buffer, f.mimetype, {
                folder:
                  process.env.CLOUDINARY_UPLOAD_FOLDER ||
                  'hanala/returns/evidence',
                maxBytes,
                allowedMime: allowed,
              }),
            ),
          )
        : [];

    const baseMeta =
      normalizedBody?.metadata != null &&
      typeof normalizedBody.metadata === 'object' &&
      !Array.isArray(normalizedBody.metadata)
        ? (normalizedBody.metadata as Record<string, unknown>)
        : undefined;

    const nextMeta =
      uploadedUrls.length > 0
        ? { ...(baseMeta ?? {}), evidenceImages: uploadedUrls }
        : baseMeta;

    const nb = normalizedBody;
    const finalBody: CreateReturnRequestBody = {
      items: nb.items ?? [],
      reasonCode: nb.reasonCode ?? 'other',
      reasonText: nb.reasonText === undefined ? null : nb.reasonText,
      requestedSolution: nb.requestedSolution,
      metadata: nextMeta,
    };

    return this.returnsService.createReturnRequestForCustomer(
      decoded.accountId,
      id,
      finalBody,
    );
  }

  @Get(':id/returns')
  async getReturnRequest(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.returnsService.getReturnRequestForCustomer(
      decoded.accountId,
      id,
    );
  }

  @Delete(':id')
  async cancel(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.cancelForCustomer(decoded.accountId, id);
  }

  @Get('track/:id')
  async track(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.trackForCustomer(decoded.accountId, id);
  }

  @Post(':id/reorder')
  async reorder(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token) as JwtPayload;
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.reorderForCustomer(decoded.accountId, id);
  }
}
