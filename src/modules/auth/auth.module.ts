import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthService } from '@modules/auth/auth.service';
import { AuthController } from '@modules/auth/auth.controller';
import { AuthEmailService } from '@modules/auth/auth-email.service';
import { AuthRepository } from '@infra/repositories/auth.repository';
import { AuthProfileController } from '@modules/auth/profile/profile.controller';
import { AuthPasswordController } from '@modules/auth/password/password.controller';
import { AuthGoogleController } from '@modules/auth/google/google.controller';
import { AuthPasswordService } from '@modules/auth/password/password.service';
import { AuthGoogleService } from '@modules/auth/google/google.service';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthPasswordService,
    AuthGoogleService,
    AuthEmailService,
    AuthRepository,
  ],
  controllers: [
    AuthController,
    AuthProfileController,
    AuthPasswordController,
    AuthGoogleController,
  ],
  exports: [AuthService, AuthPasswordService, AuthGoogleService, AuthRepository],
})
export class AuthModule {}

