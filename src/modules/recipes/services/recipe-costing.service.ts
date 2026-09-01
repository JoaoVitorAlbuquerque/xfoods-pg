import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export class InvalidWastePercentException extends BadRequestException {
  constructor(value: unknown) {
    super(
      `wastePercent must be between 0 and 100 (exclusive), received ` +
        `${String(value)}. A 100% loss would require an infinite amount of ` +
        'the supply to yield anything.',
    );
  }
}

export type ItemCost = {
  /** Quantidade que a receita pede, já na unidade base. */
  netQuantity: Prisma.Decimal;
  /** Quantidade que precisa sair do estoque, considerando a perda. */
  effectiveQuantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
};

/**
 * Matemática de custo da ficha técnica. Sem banco e sem Nest de propósito:
 * é o cálculo que sustenta margem e rentabilidade, e precisa ser verificável
 * sozinho.
 *
 * CONVENÇÃO DE PERDA: `wastePercent` é quanto se perde do que entra no preparo,
 * não um acréscimo sobre o líquido. Para render 200 g de queijo ralado com 10%
 * de perda é preciso partir de 200 / (1 - 0,10) = 222,22 g — e não de 220 g.
 * É a definição usada em ficha técnica de cozinha (fator de correção); usar
 * `líquido × (1 + perda)` subestimaria o consumo em toda saída de estoque.
 */
@Injectable()
export class RecipeCostingService {
  /** Quantidade bruta necessária para sobrar a quantidade líquida pedida. */
  effectiveQuantity(
    netQuantity: Prisma.Decimal | string | number,
    wastePercent: Prisma.Decimal | string | number = 0,
  ): Prisma.Decimal {
    const net = new Prisma.Decimal(netQuantity);
    const waste = this.parseWaste(wastePercent);

    if (waste.isZero()) {
      return net;
    }

    const yieldFactor = new Prisma.Decimal(1).sub(waste.div(100));

    return net.div(yieldFactor);
  }

  itemCost(
    netQuantity: Prisma.Decimal | string | number,
    wastePercent: Prisma.Decimal | string | number,
    unitCost: Prisma.Decimal | string | number,
  ): ItemCost {
    const net = new Prisma.Decimal(netQuantity);

    if (net.lte(0)) {
      throw new BadRequestException(
        `Recipe item quantity must be greater than zero, received ${net.toString()}.`,
      );
    }

    const effective = this.effectiveQuantity(net, wastePercent);
    const cost = new Prisma.Decimal(unitCost);

    return {
      netQuantity: net,
      effectiveQuantity: effective,
      unitCost: cost,
      totalCost: effective.mul(cost),
    };
  }

  sum(costs: ItemCost[]): Prisma.Decimal {
    return costs.reduce(
      (total, item) => total.add(item.totalCost),
      new Prisma.Decimal(0),
    );
  }

  /**
   * Custo de uma unidade do que a ficha rende. Para prato com rendimento 1 é o
   * próprio custo direto; para sub-receita que rende 2000 ML, é o custo por ML.
   */
  costPerYieldUnit(
    directCost: Prisma.Decimal,
    yieldQuantity: Prisma.Decimal | string | number,
  ): Prisma.Decimal {
    const quantity = new Prisma.Decimal(yieldQuantity);

    if (quantity.lte(0)) {
      throw new BadRequestException(
        'Recipe yield quantity must be greater than zero.',
      );
    }

    return directCost.div(quantity);
  }

  private parseWaste(
    wastePercent: Prisma.Decimal | string | number,
  ): Prisma.Decimal {
    let waste: Prisma.Decimal;

    try {
      waste = new Prisma.Decimal(wastePercent ?? 0);
    } catch {
      throw new InvalidWastePercentException(wastePercent);
    }

    if (!waste.isFinite() || waste.lt(0) || waste.gte(100)) {
      throw new InvalidWastePercentException(wastePercent);
    }

    return waste;
  }
}
