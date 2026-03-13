import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CustomersService } from '@modules/customers/customers.service';
import { AuthService, type JwtPayload } from '@modules/auth/auth.service';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly authService: AuthService,
  ) { }

  @Get('by-account')
  async getByAccount(@Query('accountId') accountId?: string) {
    if (!accountId) {
      return { error: 'Missing accountId' };
    }
    const customer = await this.customersService.getByAccountId(accountId);
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
