import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { AdminSupportService } from './admin-support.service';

@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly adminSupport: AdminSupportService) {}

  @Get('tickets')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  list(
    @CurrentAccount() account: JwtPayload | null,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.adminSupport.listTickets({ status, category, from, to });
  }

  @Get('tickets/:ticketId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getOne(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ticketId') ticketId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.adminSupport.getTicket(ticketId);
  }

  @Post('tickets/:ticketId/claim')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  claim(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ticketId') ticketId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.adminSupport.claimTicket(account.accountId, ticketId);
  }

  @Patch('tickets/:ticketId/status')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  patchStatus(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ticketId') ticketId: string,
    @Body() body: { status: string },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.adminSupport.setStatus(ticketId, body);
  }

  @Post('tickets/:ticketId/reply')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  reply(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ticketId') ticketId: string,
    @Body() body: { message: string },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.adminSupport.replyAndNotify(account.accountId, ticketId, body);
  }
}
