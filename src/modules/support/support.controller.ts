import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: { subject: string; description: string; category?: string },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.supportService.createTicket(account.accountId, account.role, body);
  }

  @Get('tickets')
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentAccount() account: JwtPayload | null,
    @Query('status') status?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.supportService.listMyTickets(account.accountId, account.role, {
      status,
    });
  }

  @Get('tickets/:ticketId')
  @UseGuards(JwtAuthGuard)
  getOne(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ticketId') ticketId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.supportService.getMyTicket(
      account.accountId,
      account.role,
      ticketId,
    );
  }

  @Patch('tickets/:ticketId')
  @UseGuards(JwtAuthGuard)
  update(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ticketId') ticketId: string,
    @Body() body: { subject?: string; description?: string; category?: string },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.supportService.updateMyTicket(
      account.accountId,
      account.role,
      ticketId,
      body,
    );
  }

  @Delete('tickets/:ticketId')
  @UseGuards(JwtAuthGuard)
  delete(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ticketId') ticketId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException();
    }
    return this.supportService.deleteMyTicket(
      account.accountId,
      account.role,
      ticketId,
    );
  }
}
