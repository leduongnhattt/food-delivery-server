import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseNotificationsService } from './enterprise-notifications.service';
import type { EnterpriseNotificationsListQueryDto } from './dto/enterprise-notifications-list.dto';

@Controller('enterprise/notifications')
export class EnterpriseNotificationsController {
  constructor(private readonly service: EnterpriseNotificationsService) {}

  private assertEnterprise(account: JwtPayload | null): asserts account is JwtPayload & {
    accountId: string;
  } {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentAccount() account: JwtPayload | null,
    @Query() queryParams: EnterpriseNotificationsListQueryDto,
  ) {
    this.assertEnterprise(account);
    const listOptions = this.service.parseListQuery(queryParams);
    return this.service.list(account.accountId, listOptions);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  async read(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') notificationId: string,
  ) {
    this.assertEnterprise(account);
    return this.service.markRead(account.accountId, notificationId);
  }

  @Patch('read-all')
  @UseGuards(JwtAuthGuard)
  async readAll(@CurrentAccount() account: JwtPayload | null) {
    this.assertEnterprise(account);
    return this.service.markAllRead(account.accountId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') notificationId: string,
  ) {
    this.assertEnterprise(account);
    return this.service.delete(account.accountId, notificationId);
  }
}

