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
import { AuthService } from '@modules/auth/auth.service';
import { uploadBufferToCloudinary } from '@infra/cloudinary/cloudinary.service';

interface UploadedAvatarFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('enterprise')
export class EnterpriseAvatarController {
  constructor(private readonly authService: AuthService) {}

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentAccount() account: JwtPayload | null,
    @UploadedFile() file?: UploadedAvatarFile,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG, WEBP, GIF images are allowed',
      );
    }

    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException('File too large (max 5MB)');
    }

    const publicUrl = await uploadBufferToCloudinary(file.buffer, file.mimetype, {
      folder: 'enterprise/avatars',
      maxBytes,
    });

    await this.authService.updateAvatar(account.accountId, publicUrl);

    return { success: true, url: publicUrl, message: 'Avatar updated successfully' };
  }
}

