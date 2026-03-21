import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AdminProfileController } from './admin-profile.controller';
import { AdminProfileService } from './admin-profile.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminProfileController],
  providers: [AdminProfileService],
})
export class AdminProfileModule {}
