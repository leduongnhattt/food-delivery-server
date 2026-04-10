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
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getSettings(@CurrentAccount() account: JwtPayload | null) {
    if (!account?.accountId) {
      throw new BadRequestException('Unauthorized');
    }
    const settings = await this.settings.getJson<Record<string, unknown>>(
      `account:${account.accountId}`,
    );
    return {
      settings,
      message: 'Settings loaded',
    };
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  async updateSettings(
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
    await this.settings.setJson(`account:${account.accountId}`, body);
    return {
      success: true,
      message: 'Settings saved successfully',
      settings: body,
    };
  }
}
