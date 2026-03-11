import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthService } from '@modules/auth/auth.service';
import { AuthController } from '@modules/auth/auth.controller';
import { AuthEmailService } from '@modules/auth/auth-email.service';
import { AuthRepository } from '@infra/repositories/auth.repository';

@Module({
  imports: [PrismaModule],
  providers: [AuthService, AuthEmailService, AuthRepository],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}

