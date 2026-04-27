import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { AdminCommissionFeesService } from './admin-commission-fees.service';

@Controller('admin/finance/commission-fees')
export class AdminCommissionFeesController {
  constructor(private readonly service: AdminCommissionFeesService) {}

  @Get('global')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getGlobal(@CurrentAccount() account: JwtPayload | null) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.getActiveGlobalRule();
  }

  @Get('global-rules')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  listGlobalRules(@CurrentAccount() account: JwtPayload | null) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.listGlobalRules();
  }

  @Post('global-rules')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  createGlobalRule(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      ruleName?: unknown;
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.createGlobalRule(account.accountId, body);
  }

  @Patch('global-rules/:ruleId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  patchGlobalRule(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ruleId') ruleId: string,
    @Body()
    body: {
      ruleName?: unknown;
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.updateGlobalRule(account.accountId, ruleId, body);
  }

  @Patch('global-rules/:ruleId/activate')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  activateGlobalRule(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ruleId') ruleId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.activateGlobalRule(account.accountId, ruleId);
  }

  @Patch('global')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  patchGlobal(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      ruleName?: unknown;
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    // Back-compat: PATCH /global creates a new rule (pending by default).
    return this.service.createGlobalRule(account.accountId, body);
  }

  @Get('category-rules')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  listCategoryRules(
    @CurrentAccount() account: JwtPayload | null,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('foodCategoryId') foodCategoryId?: string,
    @Query('status') status?: string,
    @Query('isActive') isActive?: string,
    @Query('effectiveFrom') effectiveFrom?: string,
    @Query('effectiveTo') effectiveTo?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const q = this.service.parseListQuery({
      page,
      pageSize,
      search,
      foodCategoryId,
      status,
      isActive,
      effectiveFrom,
      effectiveTo,
    });
    return this.service.listCategoryRules(q);
  }

  @Post('category-rules')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  createCategoryRule(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      foodCategoryId?: unknown;
      ruleName?: unknown;
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.createCategoryRule(account.accountId, body);
  }

  @Get('category-rules/:commissionDefaultId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getCategoryRule(
    @CurrentAccount() account: JwtPayload | null,
    @Param('commissionDefaultId') commissionDefaultId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.getCategoryRule(commissionDefaultId);
  }

  @Patch('category-rules/:commissionDefaultId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  patchCategoryRule(
    @CurrentAccount() account: JwtPayload | null,
    @Param('commissionDefaultId') commissionDefaultId: string,
    @Body()
    body: {
      foodCategoryId?: unknown;
      ruleName?: unknown;
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.updateCategoryRule(
      account.accountId,
      commissionDefaultId,
      body,
    );
  }
}
