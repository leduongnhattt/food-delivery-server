import {
  BadRequestException,
  Controller,
  Delete,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express/multer';
import { UploadedFile } from '@nestjs/common/decorators';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

interface UploadedLocalFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

@Controller('enterprise/upload')
export class EnterpriseLocalUploadController {
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentAccount() account: JwtPayload | null,
    @UploadedFile() file?: UploadedLocalFile,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }

    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed',
      );
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size too large. Maximum size is 5MB');
    }

    const timestamp = Date.now();
    const ext = (() => {
      const raw = file.originalname ? path.extname(file.originalname) : '';
      return raw || '.webp';
    })();
    const fileName = `enterprise_${timestamp}${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'images', 'enterprise');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, file.buffer);

    const imageUrl = `/images/enterprise/${fileName}`;
    return {
      message: 'File uploaded successfully',
      url: imageUrl,
      filename: fileName,
    };
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  async remove(
    @CurrentAccount() account: JwtPayload | null,
    @Query('url') imageUrl: string,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }

    if (!imageUrl) {
      throw new BadRequestException('Image URL is required');
    }
    if (!imageUrl.startsWith('/images/enterprise/')) {
      throw new BadRequestException(
        'Invalid image URL. Only enterprise images can be deleted',
      );
    }

    const filename = path.basename(imageUrl);
    if (!filename.match(/^enterprise_\d+\.(jpg|jpeg|png|gif|webp)$/i)) {
      throw new BadRequestException('Invalid filename format');
    }

    const filePath = path.join(
      process.cwd(),
      'public',
      'images',
      'enterprise',
      filename,
    );

    if (!existsSync(filePath)) {
      throw new BadRequestException('File not found');
    }

    await unlink(filePath);
    return { message: 'File deleted successfully', deletedUrl: imageUrl };
  }
}

