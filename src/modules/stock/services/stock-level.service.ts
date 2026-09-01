import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export enum StockStatus {
  /** Saldo abaixo de zero. Só existe se `allowNegativeStock` estiver ligado. */
  NEGATIVE = 'NEGATIVE',
  ZERO = 'ZERO',
  /** No mínimo ou abaixo dele: hora de comprar. */
  LOW = 'LOW',
  /** Acima do máximo configurado: capital parado, risco de vencimento. */
  OVER = 'OVER',
  OK = 'OK',
}

export type StockLevelInput = {
  currentStock: Prisma.Decimal | string | number;
  minStock: Prisma.Decimal | string | number;
  maxStock?: Prisma.Decimal | string | number | null;
};

/**
 * Classificação de nível de estoque. Sem banco e sem Nest de propósito: é a
 * regra que decide o que aparece como alerta, e ela precisa ser verificável
 * sozinha.
 *
 * A ordem de precedência importa. Um insumo negativo também está abaixo do
 * mínimo, mas quem olha a lista precisa ver "negativo" — é o problema mais
 * grave e o que exige conferência imediata.
 */
@Injectable()
export class StockLevelService {
  getStatus(input: StockLevelInput): StockStatus {
    const current = new Prisma.Decimal(input.currentStock);
    const min = new Prisma.Decimal(input.minStock ?? 0);

    if (current.lt(0)) {
      return StockStatus.NEGATIVE;
    }

    if (current.isZero()) {
      return StockStatus.ZERO;
    }

    // `minStock` zero significa "não acompanho mínimo deste insumo", não
    // "o mínimo é zero" — senão todo insumo cadastrado sem mínimo viveria
    // em alerta e o painel de alertas perderia a utilidade.
    if (min.gt(0) && current.lte(min)) {
      return StockStatus.LOW;
    }

    if (input.maxStock !== null && input.maxStock !== undefined) {
      const max = new Prisma.Decimal(input.maxStock);

      if (max.gt(0) && current.gt(max)) {
        return StockStatus.OVER;
      }
    }

    return StockStatus.OK;
  }

  needsAttention(input: StockLevelInput): boolean {
    return this.getStatus(input) !== StockStatus.OK;
  }

  /** Quanto falta para voltar ao mínimo. Zero quando não há falta. */
  shortfall(input: StockLevelInput): Prisma.Decimal {
    const current = new Prisma.Decimal(input.currentStock);
    const min = new Prisma.Decimal(input.minStock ?? 0);
    const missing = min.sub(current);

    return missing.gt(0) ? missing : new Prisma.Decimal(0);
  }

  /** Severidade para ordenar o painel: o mais grave primeiro. */
  severity(status: StockStatus): number {
    switch (status) {
      case StockStatus.NEGATIVE:
        return 0;
      case StockStatus.ZERO:
        return 1;
      case StockStatus.LOW:
        return 2;
      case StockStatus.OVER:
        return 3;
      default:
        return 4;
    }
  }
}
