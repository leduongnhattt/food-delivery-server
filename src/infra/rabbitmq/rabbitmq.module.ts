import { Module } from '@nestjs/common';
import { MailModule } from '@infra/mail/mail.module';
import { RabbitMqService } from './rabbitmq.service';

@Module({
  imports: [MailModule],
  providers: [RabbitMqService],
  exports: [RabbitMqService],
})
export class RabbitMqModule {}
