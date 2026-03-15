import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { CustomersController } from '@modules/customers/customers.controller';
import { CustomersService } from '@modules/customers/customers.service';
import { AuthModule } from '@modules/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
