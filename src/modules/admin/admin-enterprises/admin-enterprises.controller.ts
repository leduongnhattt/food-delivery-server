import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import {
  AdminEnterprisesService,
  type CreateEnterpriseBody,
  type UpdateEnterpriseBody,
} from './admin-enterprises.service';

@Controller('admin/enterprises')
export class AdminEnterprisesController {
  constructor(
    private readonly adminEnterprisesService: AdminEnterprisesService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const q = this.adminEnterprisesService.parseListQuery(status, search);
    return this.adminEnterprisesService.listEnterprises(q);
  }

  @Delete(':enterpriseId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  softDelete(@Param('enterpriseId') enterpriseId: string) {
    return this.adminEnterprisesService.softDeleteEnterprise(enterpriseId);
  }

  @Get(':enterpriseId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  detail(@Param('enterpriseId') enterpriseId: string) {
    return this.adminEnterprisesService.getEnterpriseDetail(enterpriseId);
  }

  @Patch(':enterpriseId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  update(
    @Param('enterpriseId') enterpriseId: string,
    @Body() body: UpdateEnterpriseBody,
  ) {
    return this.adminEnterprisesService.updateEnterprise(enterpriseId, body);
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  create(@Body() body: CreateEnterpriseBody) {
    return this.adminEnterprisesService.createEnterprise(body);
  }

  @Post(':accountId/lock')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  lock(@Param('accountId') accountId: string) {
    return this.adminEnterprisesService.lockEnterpriseAccount(accountId);
  }

  @Post(':accountId/unlock')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  unlock(@Param('accountId') accountId: string) {
    return this.adminEnterprisesService.unlockEnterpriseAccount(accountId);
  }
}
