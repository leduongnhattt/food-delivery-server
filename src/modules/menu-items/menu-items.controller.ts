import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MenuItemsService } from '@modules/menu-items/menu-items.service';
import type {
  CreateMenuItemBodyDto,
  MenuItemsListQueryDto,
  UpdateMenuItemBodyDto,
} from '@modules/menu-items/dto/menu-items.dto';

@Controller('menu-items')
export class MenuItemsController {
  constructor(private readonly menuItemsService: MenuItemsService) {}

  @Get()
  list(@Query() query: MenuItemsListQueryDto) {
    return this.menuItemsService.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateMenuItemBodyDto) {
    return this.menuItemsService.create(body);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.menuItemsService.findById(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateMenuItemBodyDto) {
    return this.menuItemsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.menuItemsService.remove(id);
  }
}
