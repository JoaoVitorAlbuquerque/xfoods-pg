import { Injectable, NotImplementedException } from '@nestjs/common';
import { CostingMethod, Prisma } from '@prisma/client';

export type CostableSupply = {
  costingMethod: CostingMethod;
  lastCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal;
};

/**
 * Decide qual número vale como "custo atual" de um insumo.
 *
 * Existe para que trocar de método de custeio seja mudar um campo, e não
 * reescrever quem valoriza saída de estoque. Nesta versão só LAST_PURCHASE
 * está implementado, como o escopo define; os demais recusam explicitamente em
 * vez de devolver um número plausível e errado.
 *
 * `averageCost` continua sendo mantido a cada entrada pelo motor de estoque,
 * então AVERAGE já nasce com dado acumulado para quando for habilitado.
 */
@Injectable()
export class SupplyCostingService {
  getCurrentUnitCost(supply: CostableSupply): Prisma.Decimal {
    switch (supply.costingMethod) {
      case CostingMethod.LAST_PURCHASE:
        // Sem compra registrada ainda, `lastCost` é nulo. Cai no custo médio,
        // que nesse caso também é zero — o insumo simplesmente não tem custo
        // conhecido, e o zero é honesto.
        return supply.lastCost === null
          ? new Prisma.Decimal(supply.averageCost ?? 0)
          : new Prisma.Decimal(supply.lastCost);

      case CostingMethod.AVERAGE:
        throw new NotImplementedException(
          'Average costing is not enabled yet. The average is already ' +
            'maintained on every entry, so enabling it is a matter of ' +
            'validating how adjustments and returns should affect it.',
        );

      case CostingMethod.FIFO:
        throw new NotImplementedException(
          'FIFO costing is not implemented yet: it requires consuming stock ' +
            'in cost layers, which the ledger does not yet track.',
        );

      case CostingMethod.BY_BATCH:
        throw new NotImplementedException(
          'Batch costing is not implemented yet: purchase items already carry ' +
            'a batch, but stock is not segregated by batch.',
        );

      default:
        throw new NotImplementedException(
          `Unknown costing method: ${supply.costingMethod}.`,
        );
    }
  }
}
