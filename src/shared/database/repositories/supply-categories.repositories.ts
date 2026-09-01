import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

/**
 * Diferente dos repositorios mais antigos do projeto, os metodos aqui sao
 * genericos. Sem isso o tipo de retorno ignora o `include` recebido, e todo
 * consumidor precisa afirmar tipos na mao para acessar as relacoes.
 */
@Injectable()
export class SupplyCategoriesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create<T extends Prisma.SupplyCategoryCreateArgs>(
    createDto: Prisma.SelectSubset<T, Prisma.SupplyCategoryCreateArgs>,
  ) {
    return this.prismaService.supplyCategory.create<T>(createDto);
  }

  findMany<T extends Prisma.SupplyCategoryFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.SupplyCategoryFindManyArgs>,
  ) {
    return this.prismaService.supplyCategory.findMany<T>(findManyDto);
  }

  findFirst<T extends Prisma.SupplyCategoryFindFirstArgs>(
    findFirstDto: Prisma.SelectSubset<T, Prisma.SupplyCategoryFindFirstArgs>,
  ) {
    return this.prismaService.supplyCategory.findFirst<T>(findFirstDto);
  }

  count(countDto: Prisma.SupplyCategoryCountArgs) {
    return this.prismaService.supplyCategory.count(countDto);
  }

  update<T extends Prisma.SupplyCategoryUpdateArgs>(
    updateDto: Prisma.SelectSubset<T, Prisma.SupplyCategoryUpdateArgs>,
  ) {
    return this.prismaService.supplyCategory.update<T>(updateDto);
  }
}
