import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticateDto } from './dto/authenticate.dto';
import { IsPublic } from 'src/shared/decorators/IsPublic';

@IsPublic()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-in')
  authenticate(@Body() authenticateDto: AuthenticateDto) {
    return this.authService.authenticate(authenticateDto);
  }
}
