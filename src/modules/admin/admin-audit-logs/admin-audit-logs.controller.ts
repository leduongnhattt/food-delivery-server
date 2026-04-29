import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { AdminAuditLogsService } from './admin-audit-logs.service';

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AdminAuditLogsController {
  constructor(private readonly service: AdminAuditLogsService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('user') user?: string,
    @Query('role') role?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('status') status?: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('order') order?: string,
  ) {
    return this.service.list({
      search,
      user,
      role,
      module,
      action,
      status,
      range,
      from,
      to,
      page,
      limit,
      order,
    });
  }

  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('export')
  async exportCsv(
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('user') user?: string,
    @Query('role') role?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('status') status?: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('order') order?: string,
  ) {
    const csv = await this.service.exportCsv({
      search,
      user,
      role,
      module,
      action,
      status,
      range,
      from,
      to,
      order,
    });

    const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }
}

