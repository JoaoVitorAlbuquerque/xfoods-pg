import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { compare } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

import { UsersRepository } from 'src/shared/database/repositories/users.repositories';
import { UsersService } from 'src/modules/users/users.service';
import { AuthenticateDto } from './dto/authenticate.dto';
import { SignUpDto } from './dto/sign-up.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async authenticate(authenticateDto: AuthenticateDto) {
    const { email, password } = authenticateDto;

    const user = await this.usersRepo.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isPasswordValid = await compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.generateAccessToken(user.id, user.role);
  }

  /**
   * Cadastro que ja entra autenticado.
   *
   * Devolve o mesmo `{ accessToken }` do sign-in de proposito: sem isso o
   * cliente precisaria emendar um sign-in logo apos o cadastro, repetindo a
   * senha na rede e abrindo a janela em que a conta existe e o usuario ainda
   * nao esta dentro.
   *
   * A criacao em si e do `UsersService` — hash de senha e e-mail unico moram
   * la, e este metodo nao deve ter uma segunda versao dessas regras.
   */
  async signUp(signUpDto: SignUpDto) {
    const user = await this.usersService.create(signUpDto);

    return this.generateAccessToken(user.id, user.role);
  }

  /**
   * Uma unica fonte para as claims. Se sign-in e sign-up montassem o token
   * separadamente, bastaria uma delas esquecer o `role` para o `RolesGuard`
   * passar a decidir com base em `undefined`.
   */
  private async generateAccessToken(userId: string, role: UserRole) {
    const accessToken = await this.jwtService.signAsync({
      sub: userId,
      role,
    });

    return { accessToken };
  }
}
