import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  // Exportado para o `AuthModule`: o cadastro por `/auth/sign-up` reaproveita
  // esta criacao em vez de duplicar hash de senha e checagem de e-mail unico —
  // duas copias dessa regra sao duas chances de elas divergirem.
  exports: [UsersService],
})
export class UsersModule {}
