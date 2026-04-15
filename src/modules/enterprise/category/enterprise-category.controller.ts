import { Controller, Get } from '@nestjs/common';
import { EnterpriseCategoryService } from '@modules/enterprise/category/enterprise-category.service';

@Controller('enterprise')
export class EnterpriseCategoryController {
  constructor(private readonly service: EnterpriseCategoryService) {}

  @Get('category')
  async list() {
    return this.service.list();
  }
}

