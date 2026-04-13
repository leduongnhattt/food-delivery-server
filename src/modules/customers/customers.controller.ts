import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from '@modules/customers/customers.service';
import type { JwtPayload } from '@modules/auth/auth.service';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('by-account')
  @UseGuards(JwtAuthGuard)
  async getByAccount(
    @CurrentAccount() jwt: JwtPayload | null,
    @Query('accountId') accountId?: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    if (!accountId) {
      throw new BadRequestException('Missing accountId');
    }
    if (accountId !== jwt.accountId) {
      throw new ForbiddenException('accountId does not match authenticated user');
    }
    const customer =
      await this.customersService.ensureCustomerRowForAccount(accountId);
    if (!customer) {
      return { error: 'Customer not found' };
    }
    return { customer };
  }

  @Put('update-profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      fullName?: string;
      phone?: string;
      address?: string;
    },
  ) {
    if (!account) {
      return { error: 'Unauthorized' };
    }
    const updated = await this.customersService.updateProfile(
      account.accountId,
      {
        fullName: body.fullName,
        phone: body.phone,
        address: body.address,
      },
    );
    if (!updated) {
      return { error: 'Failed to update profile' };
    }
    return { customer: updated };
  }
}
