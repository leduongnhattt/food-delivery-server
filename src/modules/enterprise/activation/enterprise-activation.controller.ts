import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { EnterpriseActivationService } from './enterprise-activation.service';

@Controller('enterprise/activation')
export class EnterpriseActivationController {
  constructor(private readonly activation: EnterpriseActivationService) {}

  @Get('verify-invite')
  verifyInvite(@Query('token') token: string) {
    return this.activation.verifyInvite(token);
  }

  @Post('step1')
  step1(
    @Body()
    body: { token: string; enterpriseName: string; password: string },
  ) {
    return this.activation.step1(body);
  }

  @Post('send-otp')
  sendOtp(@Body() body: { token: string }) {
    return this.activation.sendOtp(body);
  }

  @Post('verify-otp')
  verifyOtp(@Body() body: { token: string; otp: string }) {
    return this.activation.verifyOtp(body);
  }

  @Post('step3')
  step3(
    @Body()
    body: {
      token: string;
      address: string;
      latitude: number;
      longitude: number;
      openHours: string;
      closeHours: string;
      description?: string;
    },
  ) {
    return this.activation.step3(body);
  }
}

