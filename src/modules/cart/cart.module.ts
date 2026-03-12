import { Module } from '@nestjs/common';
import { CartController } from '@modules/cart/cart.controller';
import { CartService } from '@modules/cart/cart.service';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { CartRepository } from '@infra/repositories/cart.repository';

@Module({
  imports: [PrismaModule],
  controllers: [CartController],
  providers: [CartService, CartRepository],
  exports: [CartService],
})
export class CartModule {}

