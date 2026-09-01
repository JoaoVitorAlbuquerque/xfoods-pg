import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SuppliesRepository } from 'src/shared/database/repositories/supplies.repositories';
import { SupplyCostHistoryRepository } from 'src/shared/database/repositories/supply-cost-history.repositories';

const HISTORY_INCLUDE = {
  unit: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, name: true } },
  purchaseItem: {
    select: {
      id: true,
      quantity: true,
      totalPrice: true,
      batch: true,
      purchase: {
        select: { id: true, documentNumber: true, issuedAt: true },
      },
    },
  },
} satisfies Prisma.SupplyCostHistoryInclude;

@Injectable()
export class SupplyCostsService {
  constructor(
    private readonly suppliesRepo: SuppliesRepository,
    private readonly costHistoryRepo: SupplyCostHistoryRepository,
  ) {}

  /**
   * Histórico completo de um insumo, do mais recente ao mais antigo.
   * Append-only: nenhuma linha é sobrescrita quando um preço novo chega.
   */
  async findHistoryBySupply(userId: string, supplyId: string) {
    const supply = await this.suppliesRepo.findFirst({
      where: { id: supplyId, userId },
      include: { baseUnit: { select: { code: true, name: true } } },
    });

    if (!supply) {
      throw new NotFoundException('Supply not found.');
    }

    const history = await this.costHistoryRepo.findMany({
      where: { userId, supplyId },
      include: HISTORY_INCLUDE,
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      supply: {
        id: supply.id,
        name: supply.name,
        baseUnit: supply.baseUnit,
        currentUnitCostBase: supply.lastCost,
        costingMethod: supply.costingMethod,
      },
      history,
    };
  }

  /**
   * Relatório de variação de preço: último custo contra o anterior.
   *
   * A comparação é sempre por unidade base. Uma compra em KG e outra em G
   * geram preços unitários incomparáveis; só o custo por unidade base diz se
   * o insumo encareceu.
   */
  async getVariationReport(userId: string) {
    const supplies = await this.suppliesRepo.findMany({
      where: { userId, active: true, costHistory: { some: {} } },
      include: {
        baseUnit: { select: { code: true, name: true } },
        lastSupplier: { select: { id: true, name: true } },
        costHistory: {
          orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
          take: 2,
          include: {
            unit: { select: { code: true } },
            supplier: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const items = supplies.map((supply) => {
      const [latest, previous] = supply.costHistory;

      return {
        supplyId: supply.id,
        supplyName: supply.name,
        baseUnit: supply.baseUnit,

        // Custo comparável, por unidade base.
        currentUnitCostBase: latest.unitCostBase,
        previousUnitCostBase: latest.previousUnitCostBase,

        // Preço como foi comprado, para a tela mostrar "R$ 35/kg".
        currentUnitPrice: latest.unitPrice,
        currentPriceUnit: latest.unit.code,
        previousUnitPrice: previous?.unitPrice ?? null,
        previousPriceUnit: previous?.unit.code ?? null,

        // Congelada na confirmação da compra, não recalculada na leitura:
        // é o número que valia quando o preço mudou.
        variationPercent: latest.variationPercent,
        direction: this.direction(latest.variationPercent),

        lastPurchaseAt: latest.effectiveAt,
        previousPurchaseAt: previous?.effectiveAt ?? null,
        supplier: latest.supplier,
        purchaseCount: supply.costHistory.length,
      };
    });

    const withVariation = items.filter((item) => item.variationPercent !== null);

    return {
      items,
      summary: {
        total: items.length,
        increased: withVariation.filter((i) => i.direction === 'UP').length,
        decreased: withVariation.filter((i) => i.direction === 'DOWN').length,
        unchanged: withVariation.filter((i) => i.direction === 'FLAT').length,
        firstPurchase: items.filter((i) => i.variationPercent === null).length,
      },
    };
  }

  private direction(
    variation: Prisma.Decimal | null,
  ): 'UP' | 'DOWN' | 'FLAT' | null {
    if (variation === null) {
      return null;
    }

    const value = new Prisma.Decimal(variation);

    if (value.gt(0)) return 'UP';
    if (value.lt(0)) return 'DOWN';
    return 'FLAT';
  }
}
