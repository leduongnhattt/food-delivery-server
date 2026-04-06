import { Module } from '@nestjs/common';
import { RabbitMqModule } from '@infra/rabbitmq/rabbitmq.module';
import { SupportModule } from '@modules/support/support.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AdminSupportController } from './admin-support.controller';
import { AdminSupportService } from './admin-support.service';

@Module({
  imports: [AuthModule, SupportModule, RabbitMqModule],
  controllers: [AdminSupportController],
  providers: [AdminSupportService],
})
export class AdminSupportModule {}
