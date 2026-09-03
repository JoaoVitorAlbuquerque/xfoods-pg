import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { CONSUMPTION_MOVEMENT_TYPES } from 'src/modules/consumption/services/consumption-analysis.service';
import { DateWindow } from './sales-aggregation.service';

export type SupplyFilters = {
  supplyId?: string;
  supplyCategoryId?: string;
};

export type MovementTotal = {
  type: StockMovementType;
  /** Positivo = consumo. O sinal do razão já foi invertido. */
  quantityBase: Prisma.Decimal;
  cost: Prisma.Decimal;
  movements: number;
};

export type SupplyMovementTotal = {
  supplyId: string;
  supplyName: string;
  baseUnit: string;
  quantityBase: Prisma.Decimal;
  cost: Prisma.Decimal;
  movements: number;
};

/**
 * Números de estoque por agregação no banco.
 *
 * O razão é a tabela que mais cresce do sistema — uma venda de dez itens gera
 * dezenas de linhas. Nada aqui carrega movimentação: tudo sai de GROUP BY, e o
 * que sobe é uma linha por tipo, ou as N maiores por insumo.
 *
 * O custo usado é o `totalCost` gravado na movimentação, que é o custo do dia
 * em que ela aconteceu. É de propósito: perder 2 kg em março custou o preço de
 * março, não o de hoje.
 */
@Injectable()
export class StockAggregationService {
  constructor(private readonly prismaService: PrismaService) {}

  where(
    userId: string,
    window: DateWindow,
    filters: SupplyFilters = {},
    types?: StockMovementType[],
  ): Prisma.StockMovementWhereInput {
    return {
      userId,
      ...(types ? { type: { in: types } } : {}),
      ...(filters.supplyId ? { supplyId: filters.supplyId } : {}),
      ...(filters.supplyCategoryId
        ? { supply: { supplyCategoryId: filters.supplyCategoryId } }
        : {}),
      occurredAt: { gte: window.from, lte: this.endOfDay(window.to) },
    };
  }

  /** Consumo do período quebrado por tipo de movimentação. */
  async byType(
    userId: string,
    window: DateWindow,
    filters: SupplyFilters = {},
  ): Promise<MovementTotal[]> {
    const groups = await this.prismaService.stockMovement.groupBy({
      by: ['type'],
      where: this.where(userId, window, filters, CONSUMPTION_MOVEMENT_TYPES),
      _sum: { quantityBase: true, totalCost: true },
      _count: { _all: true },
    });

    return groups.map((group) => ({
      type: group.type,
      // Saída é negativa no razão; consumo é a leitura invertida.
      quantityBase: new Prisma.Decimal(group._sum.quantityBase ?? 0).neg(),
      cost: new Prisma.Decimal(group._sum.totalCost ?? 0).neg(),
      movements: group._count._all,
    }));
  }

  /**
   * Os N insumos que mais saíram, por valor.
   *
   * `orderBy` no SUM com `take` deixa o corte no banco: as linhas descartadas
   * nunca chegam à aplicação. Saída é negativa, então o maior consumo é o
   * total MAIS negativo — daí a ordenação ascendente.
   */
  async topBySupply(
    userId: string,
    window: DateWindow,
    options: {
      types: StockMovementType[];
      limit: number;
      filters?: SupplyFilters;
    },
  ): Promise<SupplyMovementTotal[]> {
    const groups = await this.prismaService.stockMovement.groupBy({
      by: ['supplyId'],
      where: this.where(userId, window, options.filters ?? {}, options.types),
      _sum: { quantityBase: true, totalCost: true },
      _count: { _all: true },
      orderBy: { _sum: { totalCost: 'asc' } },
      take: options.limit,
    });

    return this.withSupplyNames(userId, groups);
  }

  /** Total consumido no período, em dinheiro. */
  async consumptionCost(
    userId: string,
    window: DateWindow,
    filters: SupplyFilters = {},
  ): Promise<Prisma.Decimal> {
    const result = await this.prismaService.stockMovement.aggregate({
      where: this.where(userId, window, filters, CONSUMPTION_MOVEMENT_TYPES),
      _sum: { totalCost: true },
    });

    return new Prisma.Decimal(result._sum.totalCost ?? 0).neg();
  }

  /** Perdas registradas: o desperdício que alguém lançou. */
  async lossCost(
    userId: string,
    window: DateWindow,
    filters: SupplyFilters = {},
  ): Promise<Prisma.Decimal> {
    const result = await this.prismaService.stockMovement.aggregate({
      where: this.where(userId, window, filters, [StockMovementType.LOSS]),
      _sum: { totalCost: true },
    });

    return new Prisma.Decimal(result._sum.totalCost ?? 0).neg();
  }

  private async withSupplyNames(
    userId: string,
    groups: {
      supplyId: string;
      _sum: {
        quantityBase: Prisma.Decimal | null;
        totalCost: Prisma.Decimal | null;
      };
      _count: { _all: number };
    }[],
  ): Promise<SupplyMovementTotal[]> {
    if (groups.length === 0) {
      return [];
    }

    const supplies = await this.prismaService.supply.findMany({
      where: { userId, id: { in: groups.map((group) => group.supplyId) } },
      select: { id: true, name: true, baseUnit: { select: { code: true } } },
    });

    const byId = new Map(supplies.map((supply) => [supply.id, supply]));

    return groups.map((group) => {
      const supply = byId.get(group.supplyId);

      return {
        supplyId: group.supplyId,
        supplyName: supply?.name ?? group.supplyId,
        baseUnit: supply?.baseUnit.code ?? '',
        quantityBase: new Prisma.Decimal(group._sum.quantityBase ?? 0).neg(),
        cost: new Prisma.Decimal(group._sum.totalCost ?? 0).neg(),
        movements: group._count._all,
      };
    });
  }

  private endOfDay(date: Date) {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
}
