import {
  BadRequestException,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express/multer';
import { UploadedFile } from '@nestjs/common/decorators';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { uploadBufferToCloudinary } from '@infra/cloudinary/cloudinary.service';

interface UploadedFoodImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('enterprise')
export class EnterpriseFoodImageController {
  @Post('food-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentAccount() account: JwtPayload | null,
    @UploadedFile() file?: UploadedFoodImageFile,
  ) {
    if (!account?.accountId) {
      throw new BadRequestException('Unauthorized');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const url = await uploadBufferToCloudinary(file.buffer, file.mimetype, {
      folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'hanala/foods',
      maxBytes: 5 * 1024 * 1024,
      allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
    });

    return { url };
  }
}

