import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Percentuais que incidem sobre o PREÇO DE VENDA, não sobre o custo. */
export type PricingPercentages = {
  marginPercent: Prisma.Decimal;
  taxPercent: Prisma.Decimal;
  cardFeePercent: Prisma.Decimal;
  deliveryFeePercent: Prisma.Decimal;
  otherFeesPercent: Prisma.Decimal;
};

export type PricingBreakdown = {
  price: Prisma.Decimal;
  cost: Prisma.Decimal;
  taxes: Prisma.Decimal;
  fees: Prisma.Decimal;
  profit: Prisma.Decimal;
  /** Lucro sobre o preço — a mesma base da margem desejada. */
  marginPercent: Prisma.Decimal | null;
  /** Quanto o preço supera o custo. Outra pergunta, outra base. */
  markupOverCostPercent: Prisma.Decimal | null;
};

export type RoundingSuggestion = {
  strategy: RoundingStrategy;
  label: string;
  price: Prisma.Decimal;
  differenceFromRecommended: Prisma.Decimal;
  marginPercent: Prisma.Decimal | null;
  profit: Prisma.Decimal;
};

export enum RoundingStrategy {
  /** Dezena de centavo mais próxima: 12,54 → 12,50. */
  NEAREST_10_CENTS = 'NEAREST_10_CENTS',
  /** Terminação ,90 mais próxima: 12,54 → 12,90. */
  ENDING_90 = 'ENDING_90',
  /** Terminação ,99 mais próxima: 12,54 → 12,99. */
  ENDING_99 = 'ENDING_99',
  /** Real cheio acima: 12,54 → 13,00. */
  WHOLE_UP = 'WHOLE_UP',
}

export class UnreachablePriceException extends BadRequestException {
  constructor(totalPercent: Prisma.Decimal) {
    super(
      `Não é possível calcular o preço: impostos + taxas + margem somam ` +
        `${totalPercent.toString()}%, que é 100% ou mais. Nesse ponto não ` +
        'existe preço que cubra o custo — cada real cobrado já estaria ' +
        'inteiramente comprometido antes de pagar o insumo. Reduza a margem ' +
        'desejada ou revise as taxas.',
    );
  }
}

const MONEY_SCALE = 2;
const PERCENT_SCALE = 2;

/**
 * A conta da formação de preço.
 *
 * Imposto, taxa de cartão e margem incidem sobre o PREÇO, não sobre o custo.
 * Por isso o preço não é `custo × (1 + margem)`: somar 30% ao custo entrega
 * uma margem real bem menor que 30%, porque os percentuais que faltam ainda vão
 * ser descontados do preço final. A fórmula correta isola o preço:
 *
 *     preço = custo / (1 − impostos − taxas − margem)
 *
 * Sem banco e sem Nest de propósito: é a regra que decide quanto cobrar, e
 * precisa ser verificável sozinha.
 */
@Injectable()
export class PricingCalculatorService {
  /** Soma de tudo que sai do preço antes de sobrar lucro. */
  totalPercent(percentages: PricingPercentages): Prisma.Decimal {
    return this.feesPercent(percentages)
      .add(percentages.taxPercent)
      .add(percentages.marginPercent);
  }

  feesPercent(percentages: PricingPercentages): Prisma.Decimal {
    return new Prisma.Decimal(percentages.cardFeePercent)
      .add(percentages.deliveryFeePercent)
      .add(percentages.otherFeesPercent);
  }

  /**
   * Recusa a combinação impossível.
   *
   * Em 100% o divisor é zero e a divisão explodiria; acima de 100% ele fica
   * negativo e a conta devolveria um preço NEGATIVO — plausível na aritmética
   * e absurdo na prática. Recusar é a única resposta honesta.
   */
  assertViable(percentages: PricingPercentages) {
    for (const [name, value] of Object.entries(percentages)) {
      if (new Prisma.Decimal(value).isNegative()) {
        throw new BadRequestException(`${name} must not be negative.`);
      }
    }

    const total = this.totalPercent(percentages);

    if (total.gte(100)) {
      throw new UnreachablePriceException(total);
    }
  }

  /** `custo / (1 − impostos − taxas − margem)`, arredondado ao centavo. */
  recommendedPrice(
    cost: Prisma.Decimal | string | number,
    percentages: PricingPercentages,
  ): Prisma.Decimal {
    this.assertViable(percentages);

    const amount = new Prisma.Decimal(cost);

    if (amount.isNegative()) {
      throw new BadRequestException('Cost must not be negative.');
    }

    const divisor = new Prisma.Decimal(100)
      .sub(this.totalPercent(percentages))
      .div(100);

    return amount.div(divisor).toDecimalPlaces(MONEY_SCALE);
  }

  /**
   * Onde cada real do preço vai parar.
   *
   * Calculado a partir do preço REAL, não do desejado: depois de arredondar
   * 12,5423 para 12,54 a margem já não é exatamente 30%, e mostrar os 30%
   * pedidos em vez dos 29,99% obtidos seria repetir a intenção no lugar do
   * resultado.
   */
  breakdown(
    price: Prisma.Decimal | string | number,
    cost: Prisma.Decimal | string | number,
    percentages: PricingPercentages,
  ): PricingBreakdown {
    const finalPrice = new Prisma.Decimal(price);
    const amount = new Prisma.Decimal(cost);

    const taxes = finalPrice
      .mul(percentages.taxPercent)
      .div(100)
      .toDecimalPlaces(MONEY_SCALE);

    const fees = finalPrice
      .mul(this.feesPercent(percentages))
      .div(100)
      .toDecimalPlaces(MONEY_SCALE);

    const profit = finalPrice.sub(amount).sub(taxes).sub(fees);

    return {
      price: finalPrice.toDecimalPlaces(MONEY_SCALE),
      cost: amount.toDecimalPlaces(MONEY_SCALE),
      taxes,
      fees,
      profit: profit.toDecimalPlaces(MONEY_SCALE),
      marginPercent: finalPrice.isZero()
        ? null
        : profit.div(finalPrice).mul(100).toDecimalPlaces(PERCENT_SCALE),
      markupOverCostPercent: amount.isZero()
        ? null
        : finalPrice
            .sub(amount)
            .div(amount)
            .mul(100)
            .toDecimalPlaces(PERCENT_SCALE),
    };
  }

  /**
   * Preços "de cardápio" perto do recomendado, cada um com a margem que ele
   * realmente entrega.
   *
   * Arredondar para baixo come margem e arredondar para cima sobra: mostrar a
   * margem de cada opção é o que transforma a escolha numa decisão informada em
   * vez de um chute estético.
   */
  roundingSuggestions(
    recommended: Prisma.Decimal,
    cost: Prisma.Decimal | string | number,
    percentages: PricingPercentages,
  ): RoundingSuggestion[] {
    const options: { strategy: RoundingStrategy; label: string; price: Prisma.Decimal }[] =
      [
        {
          strategy: RoundingStrategy.NEAREST_10_CENTS,
          label: 'Dezena de centavo mais próxima',
          price: this.toNearestStep(recommended, '0.10'),
        },
        {
          strategy: RoundingStrategy.ENDING_90,
          label: 'Terminando em ,90',
          price: this.toNearestEnding(recommended, '0.90'),
        },
        {
          strategy: RoundingStrategy.ENDING_99,
          label: 'Terminando em ,99',
          price: this.toNearestEnding(recommended, '0.99'),
        },
        {
          strategy: RoundingStrategy.WHOLE_UP,
          label: 'Real cheio acima',
          price: recommended.ceil(),
        },
      ];

    const seen = new Set<string>();

    return options
      .filter((option) => {
        const key = option.price.toFixed(MONEY_SCALE);

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);

        return true;
      })
      .map((option) => {
        const detail = this.breakdown(option.price, cost, percentages);

        return {
          strategy: option.strategy,
          label: option.label,
          price: option.price.toDecimalPlaces(MONEY_SCALE),
          differenceFromRecommended: option.price
            .sub(recommended)
            .toDecimalPlaces(MONEY_SCALE),
          marginPercent: detail.marginPercent,
          profit: detail.profit,
        };
      })
      .sort((a, b) => a.price.comparedTo(b.price));
  }

  /** Múltiplo de `step` mais próximo. */
  private toNearestStep(value: Prisma.Decimal, step: string): Prisma.Decimal {
    const size = new Prisma.Decimal(step);

    return value.div(size).toDecimalPlaces(0).mul(size);
  }

  /**
   * Valor mais próximo com a terminação pedida — abaixo ou acima.
   *
   * Para 12,54 e terminação ,90 os candidatos são 11,90 e 12,90; ganha 12,90,
   * que está a 36 centavos contra 64. Forçar sempre para cima daria saltos de
   * quase um real quando o recomendado já passou da terminação.
   */
  private toNearestEnding(
    value: Prisma.Decimal,
    ending: string,
  ): Prisma.Decimal {
    const cents = new Prisma.Decimal(ending);
    const floorUnit = value.floor();

    const below = floorUnit.sub(1).add(cents);
    const above = floorUnit.add(cents);

    const candidates = [below, above].filter((candidate) =>
      candidate.gt(0),
    );

    if (candidates.length === 0) {
      return above;
    }

    return candidates.reduce((closest, candidate) =>
      candidate.sub(value).abs().lt(closest.sub(value).abs())
        ? candidate
        : closest,
    );
  }
}
