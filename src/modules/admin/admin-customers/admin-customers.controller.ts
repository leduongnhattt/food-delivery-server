import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { AdminCustomersService } from './admin-customers.service';

@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly adminCustomersService: AdminCustomersService) {}

  @Get()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const q = this.adminCustomersService.parseListQuery({
      statusRaw: status,
      searchRaw: search,
      limitRaw: limit,
      cursorRaw: cursor,
    });
    return this.adminCustomersService.listCustomers(q);
  }

  @Post(':customerId/lock')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  lock(@Param('customerId') customerId: string) {
    return this.adminCustomersService.lockCustomer(customerId);
  }

  @Post(':customerId/unlock')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  unlock(@Param('customerId') customerId: string) {
    return this.adminCustomersService.unlockCustomer(customerId);
  }
}
