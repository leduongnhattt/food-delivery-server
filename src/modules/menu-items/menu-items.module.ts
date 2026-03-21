import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { MenuItemsRepository } from '@infra/repositories/menu-items.repository';
import { MenuItemsController } from '@modules/menu-items/menu-items.controller';
import { MenuItemsService } from '@modules/menu-items/menu-items.service';

@Module({
  imports: [PrismaModule],
  controllers: [MenuItemsController],
  providers: [MenuItemsRepository, MenuItemsService],
})
export class MenuItemsModule {}
