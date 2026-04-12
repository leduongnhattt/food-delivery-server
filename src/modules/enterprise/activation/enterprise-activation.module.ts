import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { MailModule } from '@infra/mail/mail.module';
import { EnterpriseActivationController } from './enterprise-activation.controller';
import { EnterpriseActivationService } from './enterprise-activation.service';

@Module({
  imports: [PrismaModule, AuthModule, MailModule],
  controllers: [EnterpriseActivationController],
  providers: [EnterpriseActivationService],
})
export class EnterpriseActivationModule {}

