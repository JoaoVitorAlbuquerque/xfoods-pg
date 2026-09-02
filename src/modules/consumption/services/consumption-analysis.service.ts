import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

/**
 * Como o desvio se compara à tolerância configurada.
 *
 * Os nomes ficam em português porque são o vocabulário do relatório e vão
 * aparecer na tela como estão — traduzir na borda só criaria um segundo
 * dicionário para manter.
 */
export enum ConsumptionClassification {
  /** Saiu menos do que as fichas previam. */
  ABAIXO_DO_ESPERADO = 'ABAIXO_DO_ESPERADO',
  DENTRO_DA_TOLERANCIA = 'DENTRO_DA_TOLERANCIA',
  /** Saiu mais do que as fichas previam — é aqui que mora a perda. */
  ACIMA_DO_ESPERADO = 'ACIMA_DO_ESPERADO',
}

export type ComparisonInput = {
  /** Quantidade que as vendas do período deveriam ter consumido. */
  estimatedQuantity: Prisma.Decimal | string | number;
  /** Quantidade que as movimentações dizem ter saído de fato. */
  realQuantity: Prisma.Decimal | string | number;
  /** Custo por unidade base pela política de custeio do insumo. */
  unitCost: Prisma.Decimal | string | number;
  /** Margem aceitável, em porcento. */
  tolerancePercent: Prisma.Decimal | string | number;
};

export type Comparison = {
  estimatedQuantity: Prisma.Decimal;
  realQuantity: Prisma.Decimal;
  /** Real menos estimado. Positivo significa consumo além do previsto. */
  difference: Prisma.Decimal;
  /**
   * Nulo quando o estimado é zero: não existe porcentagem de uma base zero, e
   * devolver 0 ou 100 aqui seria inventar um número que a tela mostraria como
   * se fosse medido.
   */
  variationPercent: Prisma.Decimal | null;
  classification: ConsumptionClassification;
  unitCost: Prisma.Decimal;
  estimatedCost: Prisma.Decimal;
  realCost: Prisma.Decimal;
  /** Valor do desvio. Positivo é dinheiro que saiu sem venda correspondente. */
  differenceCost: Prisma.Decimal;
};

/** Casas decimais: quantidade acompanha o estoque, dinheiro acompanha o caixa. */
const QUANTITY_SCALE = 6;
const MONEY_SCALE = 4;
const PERCENT_SCALE = 2;

/**
 * Tipos que contam como consumo do período.
 *
 * PURCHASE fica de fora porque é reposição, não consumo: somá-la faria o
 * "real" cair a cada entrada de nota. RETURN entra com o sinal positivo que
 * já tem no razão, e é o que faz uma venda cancelada zerar dos dois lados.
 */
export const CONSUMPTION_MOVEMENT_TYPES: StockMovementType[] = [
  StockMovementType.SALE,
  StockMovementType.LOSS,
  StockMovementType.ADJUSTMENT,
  StockMovementType.PRODUCTION,
  StockMovementType.RETURN,
  StockMovementType.TRANSFER,
];

/**
 * Causas possíveis de um desvio, para o relatório não ser lido como se toda
 * diferença fosse desperdício.
 *
 * Vai junto de toda resposta de propósito: quem abre o relatório precisa ver a
 * lista antes de concluir qualquer coisa sobre a cozinha.
 */
export const DEVIATION_CAUSES = [
  {
    code: 'DESPERDICIO',
    label: 'Desperdício',
    description:
      'Porção servida acima da ficha, sobra de preparo, alimento descartado.',
  },
  {
    code: 'ERRO_DE_LANCAMENTO',
    label: 'Erro de lançamento',
    description:
      'Quantidade ou unidade digitada errada numa compra, numa perda ou na própria ficha.',
  },
  {
    code: 'INVENTARIO',
    label: 'Inventário',
    description:
      'Contagem física que corrigiu o saldo — o ajuste aparece como consumo mas é acerto de registro.',
  },
  {
    code: 'PRODUCAO',
    label: 'Produção',
    description:
      'Insumo consumido para produzir outro item, sem venda direta no período.',
  },
  {
    code: 'PERDAS',
    label: 'Perdas',
    description: 'Quebra, vencimento e descarte já registrados como perda.',
  },
  {
    code: 'AJUSTES',
    label: 'Ajustes',
    description: 'Correções manuais de saldo lançadas fora de um inventário.',
  },
  {
    code: 'CONSUMO_NAO_REGISTRADO',
    label: 'Consumo não registrado',
    description:
      'Consumo interno, cortesia, refeição de funcionário ou venda sem ficha técnica ativa.',
  },
] as const;

/**
 * A conta do relatório Estimado x Real.
 *
 * Sem banco e sem Nest de propósito: é a regra que decide se um insumo aparece
 * como problema, e ela precisa ser verificável sozinha. Quem busca os dados é
 * o `ConsumptionReportService`.
 */
@Injectable()
export class ConsumptionAnalysisService {
  compare(input: ComparisonInput): Comparison {
    const estimated = new Prisma.Decimal(input.estimatedQuantity);
    const real = new Prisma.Decimal(input.realQuantity);
    const unitCost = new Prisma.Decimal(input.unitCost);
    const tolerance = new Prisma.Decimal(input.tolerancePercent).abs();

    const difference = real.sub(estimated);

    // O veredito sai da porcentagem cheia; só o número exibido é arredondado.
    // Classificar sobre o valor arredondado faria uma diferença real de 0,001
    // virar 0,00% e passar como "dentro da tolerância" mesmo com tolerância
    // zero — justamente o ajuste de quem quer ver tudo.
    const rawVariation = estimated.isZero()
      ? null
      : difference.div(estimated).mul(100);

    return {
      estimatedQuantity: estimated.toDecimalPlaces(QUANTITY_SCALE),
      realQuantity: real.toDecimalPlaces(QUANTITY_SCALE),
      difference: difference.toDecimalPlaces(QUANTITY_SCALE),
      variationPercent:
        rawVariation === null
          ? null
          : rawVariation.toDecimalPlaces(PERCENT_SCALE),
      classification: this.classify(difference, rawVariation, tolerance),
      unitCost,
      estimatedCost: estimated.mul(unitCost).toDecimalPlaces(MONEY_SCALE),
      realCost: real.mul(unitCost).toDecimalPlaces(MONEY_SCALE),
      differenceCost: difference.mul(unitCost).toDecimalPlaces(MONEY_SCALE),
    };
  }

  /**
   * Sem estimativa não há porcentagem, mas ainda há veredito: consumir um
   * insumo que nenhuma venda previa é o desvio mais gritante que existe, e
   * classificá-lo como "dentro da tolerância" só porque a divisão não fecha
   * esconderia justamente o caso que o relatório precisa mostrar.
   */
  private classify(
    difference: Prisma.Decimal,
    /** Porcentagem sem arredondar — ver `compare`. */
    variationPercent: Prisma.Decimal | null,
    tolerance: Prisma.Decimal,
  ): ConsumptionClassification {
    if (variationPercent === null) {
      if (difference.isZero()) {
        return ConsumptionClassification.DENTRO_DA_TOLERANCIA;
      }

      return difference.gt(0)
        ? ConsumptionClassification.ACIMA_DO_ESPERADO
        : ConsumptionClassification.ABAIXO_DO_ESPERADO;
    }

    if (variationPercent.abs().lte(tolerance)) {
      return ConsumptionClassification.DENTRO_DA_TOLERANCIA;
    }

    return variationPercent.gt(0)
      ? ConsumptionClassification.ACIMA_DO_ESPERADO
      : ConsumptionClassification.ABAIXO_DO_ESPERADO;
  }

  /**
   * Separa o desvio no que já tem documento e no que não tem.
   *
   * `real = venda + perda + ajuste + produção + transferência`, e o estimado
   * corresponde à parte de venda. O que sobra depois de descontar os
   * lançamentos documentados é a diferença entre o que a venda deveria ter
   * consumido e o que ela consumiu — normalmente prato vendido sem ficha ativa.
   *
   * É esta separação que impede ler o total como desperdício: uma perda de 2 kg
   * já registrada explica o desvio inteiro, e não sobra nada a investigar.
   */
  explainDeviation(
    difference: Prisma.Decimal,
    realByType: Partial<Record<StockMovementType, Prisma.Decimal>>,
  ) {
    const documentedTypes = [
      StockMovementType.LOSS,
      StockMovementType.ADJUSTMENT,
      StockMovementType.PRODUCTION,
      StockMovementType.TRANSFER,
    ];

    const documented = documentedTypes.reduce(
      (total, type) => total.add(realByType[type] ?? 0),
      new Prisma.Decimal(0),
    );

    return {
      documented: documented.toDecimalPlaces(QUANTITY_SCALE),
      undocumented: difference.sub(documented).toDecimalPlaces(QUANTITY_SCALE),
    };
  }

  /**
   * Ordena do desvio mais grave para o menos grave.
   *
   * Consumo sem estimativa (porcentagem nula) vem primeiro: é variação
   * infinita, e ficaria no fim de qualquer ordenação numérica ingênua.
   */
  bySeverity<T extends { variationPercent: Prisma.Decimal | null }>(
    a: T,
    b: T,
  ): number {
    if (a.variationPercent === null && b.variationPercent === null) return 0;
    if (a.variationPercent === null) return -1;
    if (b.variationPercent === null) return 1;

    return b.variationPercent.abs().comparedTo(a.variationPercent.abs());
  }

  /** Percentual de desperdício: quanto do custo previsto virou desvio. */
  wastePercent(
    estimatedCost: Prisma.Decimal,
    differenceCost: Prisma.Decimal,
  ): Prisma.Decimal | null {
    if (estimatedCost.isZero()) {
      return null;
    }

    return differenceCost
      .div(estimatedCost)
      .mul(100)
      .toDecimalPlaces(PERCENT_SCALE);
  }
}
