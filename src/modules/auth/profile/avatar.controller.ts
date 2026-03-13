import {
  BadRequestException,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express/multer';
import { UploadedFile } from '@nestjs/common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { AuthService } from '@modules/auth/auth.service';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import { uploadBufferToCloudinary } from '@infra/cloudinary/cloudinary.service';

interface UploadedAvatarFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('auth')
export class AuthAvatarController {
  constructor(private readonly authService: AuthService) {}

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentAccount() account: JwtPayload | null,
    @UploadedFile() file?: UploadedAvatarFile,
  ) {
    if (!account || !account.accountId) {
      throw new BadRequestException('Unauthorized');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG, WEBP images are allowed',
      );
    }

    const maxBytes = 3 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException('File too large (max 3MB)');
    }

    try {
      const publicUrl = await uploadBufferToCloudinary(
        file.buffer,
        file.mimetype,
        {
          folder:
            process.env.CLOUDINARY_UPLOAD_FOLDER || 'hanala/avatars',
          maxBytes,
        },
      );

      await this.authService.updateAvatar(account.accountId, publicUrl);

      return { success: true, url: publicUrl };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Avatar upload failed:', error);
      throw new BadRequestException('Upload failed');
    }
  }
}

