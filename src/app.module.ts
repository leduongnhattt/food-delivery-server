import { Module } from '@nestjs/common';
import { AppController } from '@src/app.controller';
import { AppService } from '@src/app.service';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { FoodsModule } from '@modules/foods/foods.module';

@Module({
  imports: [PrismaModule, FoodsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
