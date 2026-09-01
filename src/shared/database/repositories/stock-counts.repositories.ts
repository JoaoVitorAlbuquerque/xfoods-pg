import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

/**
 * Diferente dos repositorios mais antigos do projeto, os metodos aqui sao
 * genericos. Sem isso o tipo de retorno ignora o `include` recebido, e todo
 * consumidor precisa afirmar tipos na mao para acessar as relacoes.
 */
@Injectable()
export class StockCountsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create<T extends Prisma.StockCountCreateArgs>(
    createDto: Prisma.SelectSubset<T, Prisma.StockCountCreateArgs>,
  ) {
    return this.prismaService.stockCount.create<T>(createDto);
  }

  findMany<T extends Prisma.StockCountFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.StockCountFindManyArgs>,
  ) {
    return this.prismaService.stockCount.findMany<T>(findManyDto);
  }

  findFirst<T extends Prisma.StockCountFindFirstArgs>(
    findFirstDto: Prisma.SelectSubset<T, Prisma.StockCountFindFirstArgs>,
  ) {
    return this.prismaService.stockCount.findFirst<T>(findFirstDto);
  }

  count(countDto: Prisma.StockCountCountArgs) {
    return this.prismaService.stockCount.count(countDto);
  }

  update<T extends Prisma.StockCountUpdateArgs>(
    updateDto: Prisma.SelectSubset<T, Prisma.StockCountUpdateArgs>,
  ) {
    return this.prismaService.stockCount.update<T>(updateDto);
  }
}
