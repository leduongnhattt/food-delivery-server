import { Module } from '@nestjs/common';
import { AppController } from '@src/app.controller';
import { AppService } from '@src/app.service';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { StripeModule } from '@infra/stripe/stripe.module';
import { FoodsModule } from '@modules/foods/foods.module';
import { AuthModule } from '@modules/auth/auth.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';
import { CartModule } from '@modules/cart/cart.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { VouchersModule } from '@modules/vouchers/vouchers.module';
import { HealthModule } from '@modules/health/health.module';

@Module({
  imports: [
    PrismaModule,
    StripeModule,
    FoodsModule,
    AuthModule,
    RestaurantsModule,
    ReviewsModule,
    CartModule,
    CustomersModule,
    OrdersModule,
    PaymentsModule,
    VouchersModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
