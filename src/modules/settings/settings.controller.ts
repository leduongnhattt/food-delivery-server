import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';

@Controller('settings')
export class SettingsController {
  @Get()
  @UseGuards(JwtAuthGuard)
  getSettings(@CurrentAccount() account: JwtPayload | null) {
    if (!account?.accountId) {
      throw new BadRequestException('Unauthorized');
    }
    return {
      settings: null,
      message: 'Settings loaded from client storage',
    };
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  updateSettings(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      language?: string;
      timezone?: string;
      [key: string]: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new BadRequestException('Unauthorized');
    }
    const { language, timezone } = body ?? {};
    if (!language || !timezone) {
      throw new BadRequestException('Language and timezone are required');
    }
    return {
      success: true,
      message: 'Settings saved successfully',
      settings: body,
    };
  }
}
