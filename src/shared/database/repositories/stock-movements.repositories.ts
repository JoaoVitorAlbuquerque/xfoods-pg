import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

/**
 * Diferente dos repositorios mais antigos do projeto, os metodos aqui sao
 * genericos. Sem isso o tipo de retorno ignora o `include` recebido, e todo
 * consumidor precisa afirmar tipos na mao para acessar as relacoes.
 */
@Injectable()
export class StockMovementsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create<T extends Prisma.StockMovementCreateArgs>(
    createDto: Prisma.SelectSubset<T, Prisma.StockMovementCreateArgs>,
  ) {
    return this.prismaService.stockMovement.create<T>(createDto);
  }

  findMany<T extends Prisma.StockMovementFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.StockMovementFindManyArgs>,
  ) {
    return this.prismaService.stockMovement.findMany<T>(findManyDto);
  }

  findFirst<T extends Prisma.StockMovementFindFirstArgs>(
    findFirstDto: Prisma.SelectSubset<T, Prisma.StockMovementFindFirstArgs>,
  ) {
    return this.prismaService.stockMovement.findFirst<T>(findFirstDto);
  }

  count(countDto: Prisma.StockMovementCountArgs) {
    return this.prismaService.stockMovement.count(countDto);
  }

  update<T extends Prisma.StockMovementUpdateArgs>(
    updateDto: Prisma.SelectSubset<T, Prisma.StockMovementUpdateArgs>,
  ) {
    return this.prismaService.stockMovement.update<T>(updateDto);
  }
}
