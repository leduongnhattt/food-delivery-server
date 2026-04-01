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
import { MenuItemsModule } from '@modules/menu-items/menu-items.module';
import { AdminModule } from '@modules/admin/admin.module';
import { WebhooksModule } from '@modules/webhooks/webhooks.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { EnterpriseModule } from '@modules/enterprise/enterprise.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { StockModule } from '@modules/stock/stock.module';
import { RegistryModule } from '@modules/registry/registry.module';

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
    MenuItemsModule,
    AdminModule,
    WebhooksModule,
    CategoriesModule,
    EnterpriseModule,
    SettingsModule,
    StockModule,
    RegistryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
