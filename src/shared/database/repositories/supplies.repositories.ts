import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

/**
 * Diferente dos repositorios mais antigos do projeto, os metodos aqui sao
 * genericos. Sem isso o tipo de retorno ignora o `include` recebido, e todo
 * consumidor precisa afirmar tipos na mao para acessar as relacoes.
 */
@Injectable()
export class SuppliesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create<T extends Prisma.SupplyCreateArgs>(
    createDto: Prisma.SelectSubset<T, Prisma.SupplyCreateArgs>,
  ) {
    return this.prismaService.supply.create<T>(createDto);
  }

  findMany<T extends Prisma.SupplyFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.SupplyFindManyArgs>,
  ) {
    return this.prismaService.supply.findMany<T>(findManyDto);
  }

  findFirst<T extends Prisma.SupplyFindFirstArgs>(
    findFirstDto: Prisma.SelectSubset<T, Prisma.SupplyFindFirstArgs>,
  ) {
    return this.prismaService.supply.findFirst<T>(findFirstDto);
  }

  count(countDto: Prisma.SupplyCountArgs) {
    return this.prismaService.supply.count(countDto);
  }

  update<T extends Prisma.SupplyUpdateArgs>(
    updateDto: Prisma.SelectSubset<T, Prisma.SupplyUpdateArgs>,
  ) {
    return this.prismaService.supply.update<T>(updateDto);
  }
}
