import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import {
  AdminEnterpriseInvitationsService,
  type InviteEnterpriseBody,
  type InvitationTemplateValue,
} from './admin-enterprise-invitations.service';

@Controller('admin/enterprise-invitations')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AdminEnterpriseInvitationsController {
  constructor(
    private readonly invitations: AdminEnterpriseInvitationsService,
  ) {}

  @Get()
  list(@Query('status') status?: string, @Query('search') search?: string) {
    return this.invitations.listInvitations({ status, search });
  }

  @Get('template')
  getTemplate() {
    return this.invitations.getTemplateForAdmin();
  }

  @Put('template')
  updateTemplate(@Body() body: InvitationTemplateValue) {
    return this.invitations.updateTemplateForAdmin(body);
  }

  @Get(':invitationId')
  detail(@Param('invitationId') invitationId: string) {
    return this.invitations.getInvitationDetail(invitationId);
  }

  @Post()
  invite(@Body() body: InviteEnterpriseBody) {
    return this.invitations.inviteEnterprise(body);
  }

  @Post(':invitationId/resend')
  resend(@Param('invitationId') invitationId: string) {
    return this.invitations.resendInvitation(invitationId);
  }

  @Post(':invitationId/revoke')
  revoke(@Param('invitationId') invitationId: string) {
    return this.invitations.revokeInvitation(invitationId);
  }
}
