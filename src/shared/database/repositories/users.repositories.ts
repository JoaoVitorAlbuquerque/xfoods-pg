import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Generico como os repositorios mais novos: sem isso o tipo de retorno
   * ignora o `select` recebido, e o cadastro continuaria parecendo devolver a
   * senha mesmo depois de deixar de devolve-la.
   */
  create<T extends Prisma.UserCreateArgs>(
    createUserDto: Prisma.SelectSubset<T, Prisma.UserCreateArgs>,
  ) {
    return this.prismaService.user.create<T>(createUserDto);
  }

  findUnique(findUniqueDto: Prisma.UserFindUniqueArgs) {
    return this.prismaService.user.findUnique(findUniqueDto);
  }
}
