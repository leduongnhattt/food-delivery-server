import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { MailModule } from '@infra/mail/mail.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { AdminEnterpriseInvitationsController } from './admin-enterprise-invitations.controller';
import { AdminEnterpriseInvitationsService } from './admin-enterprise-invitations.service';

@Module({
  imports: [PrismaModule, AuthModule, MailModule, SettingsModule],
  controllers: [AdminEnterpriseInvitationsController],
  providers: [AdminEnterpriseInvitationsService],
})
export class AdminEnterpriseInvitationsModule {}

