import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AdminEnterprisesController } from './admin-enterprises.controller';
import { AdminEnterprisesService } from './admin-enterprises.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminEnterprisesController],
  providers: [AdminEnterprisesService],
})
export class AdminEnterprisesModule {}
