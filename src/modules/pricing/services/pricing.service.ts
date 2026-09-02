import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CostAllocationService } from 'src/modules/expenses/services/cost-allocation.service';
import { PricingSettingsService } from './pricing-settings.service';
import {
  PricingCalculatorService,
  PricingPercentages,
  UnreachablePriceException,
} from './pricing-calculator.service';
import { PricingQueryDto, SimulatePricingDto } from '../dto/pricing.dto';

export enum PriceStatus {
  /** O preço não cobre nem custo, imposto e taxa: cada venda dá prejuízo. */
  ABAIXO_DO_CUSTO = 'ABAIXO_DO_CUSTO',
  ABAIXO_DO_RECOMENDADO = 'ABAIXO_DO_RECOMENDADO',
  NO_RECOMENDADO = 'NO_RECOMENDADO',
  ACIMA_DO_RECOMENDADO = 'ACIMA_DO_RECOMENDADO',
}

/** Degraus de margem do simulador, a partir da margem configurada. */
const SIMULATION_STEPS = [0, 5, 10, 15];

const MONEY_SCALE = 2;

/**
 * Preço recomendado a partir do custo completo.
 *
 * Nada aqui escreve em `products.price`. O módulo calcula e compara; aplicar o
 * preço é decisão de quem vende, e um sistema que reprecifica o cardápio
 * sozinho a cada oscilação do queijo seria pior que um que não calcula nada.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly costAllocationService: CostAllocationService,
    private readonly settingsService: PricingSettingsService,
    private readonly calculator: PricingCalculatorService,
  ) {}

  // ---------------------------------------------------------------------------
  // Preço atual x recomendado
  // ---------------------------------------------------------------------------

  async getProductPricing(userId: string, filters: PricingQueryDto) {
    const { percentages, source, fullCost } = await this.load(userId, filters);

    this.calculator.assertViable(percentages);

    const items = fullCost.items.map((item) =>
      this.priceProduct(item, percentages),
    );

    const belowCost = items.filter(
      (item) => item.status === PriceStatus.ABAIXO_DO_CUSTO,
    );
    const belowRecommended = items.filter(
      (item) => item.status === PriceStatus.ABAIXO_DO_RECOMENDADO,
    );

    return {
      period: fullCost.period,
      percentages: this.describePercentages(percentages, source),
      items: items.sort((a, b) => a.productName.localeCompare(b.productName)),
      summary: {
        products: items.length,
        belowCost: belowCost.length,
        belowRecommended: belowRecommended.length,
        atOrAbove: items.length - belowCost.length - belowRecommended.length,
        /** Quanto de lucro por unidade os preços abaixo do recomendado deixam na mesa. */
        gapPerUnit: [...belowCost, ...belowRecommended]
          .reduce(
            (total, item) => total.add(item.difference.abs()),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(MONEY_SCALE),
        productsWithoutRecipe: fullCost.summary.productsWithoutRecipe,
        withMissingSupplyCost: fullCost.summary.withMissingSupplyCost,
      },
      notes: this.notes(),
      caveats: fullCost.caveats,
    };
  }

  async getProductPricingDetail(
    userId: string,
    productId: string,
    filters: PricingQueryDto,
  ) {
    const { percentages, source, fullCost } = await this.load(userId, filters);

    this.calculator.assertViable(percentages);

    const item = fullCost.items.find(
      (candidate) => candidate.productId === productId,
    );

    if (!item) {
      throw new NotFoundException(
        'Product not found, or it has no active recipe. Without a recipe ' +
          'there is no direct cost, and without direct cost there is no price ' +
          'to recommend.',
      );
    }

    const priced = this.priceProduct(item, percentages);

    return {
      period: fullCost.period,
      percentages: this.describePercentages(percentages, source),
      ...priced,
      cost: {
        directCost: item.directCost,
        indirectCost: item.allocatedIndirectCost,
        fullCost: item.fullCost,
      },
      /** Onde cada real vai parar, no preço praticado e no recomendado. */
      profitability: {
        atCurrentPrice: priced.currentPrice
          ? this.calculator.breakdown(
              priced.currentPrice,
              item.fullCost,
              percentages,
            )
          : null,
        atRecommendedPrice: this.calculator.breakdown(
          priced.recommendedPrice,
          item.fullCost,
          percentages,
        ),
      },
      roundingSuggestions: this.calculator.roundingSuggestions(
        priced.recommendedPrice,
        item.fullCost,
        percentages,
      ),
      notes: this.notes(),
      caveats: fullCost.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Simulador
  // ---------------------------------------------------------------------------

  /**
   * Testa cenários de margem sobre um custo.
   *
   * Uma margem inviável não derruba a simulação inteira: a linha volta sem
   * preço e com o motivo, para a tabela mostrar exatamente onde a combinação
   * deixa de fechar.
   */
  async simulate(userId: string, dto: SimulatePricingDto) {
    const { percentages, source, fullCost } = await this.load(userId, dto);

    let cost: Prisma.Decimal;
    let product: { id: string; name: string } | null = null;

    if (dto.productId) {
      const item = fullCost.items.find(
        (candidate) => candidate.productId === dto.productId,
      );

      if (!item) {
        throw new NotFoundException(
          'Product not found, or it has no active recipe.',
        );
      }

      cost = new Prisma.Decimal(item.fullCost);
      product = { id: item.productId, name: item.productName };
    } else if (dto.cost !== undefined) {
      cost = new Prisma.Decimal(dto.cost);
    } else {
      throw new NotFoundException(
        'Inform productId to simulate a dish, or cost to simulate a value.',
      );
    }

    const margins = dto.margins?.length
      ? dto.margins.map((margin) => new Prisma.Decimal(margin))
      : SIMULATION_STEPS.map((step) => percentages.marginPercent.add(step));

    const scenarios = margins.map((marginPercent) => {
      const scenario: PricingPercentages = { ...percentages, marginPercent };

      try {
        const price = this.calculator.recommendedPrice(cost, scenario);
        const breakdown = this.calculator.breakdown(price, cost, scenario);

        return {
          marginPercent,
          price,
          profit: breakdown.profit,
          taxes: breakdown.taxes,
          fees: breakdown.fees,
          /** A margem obtida depois de arredondar ao centavo. */
          effectiveMarginPercent: breakdown.marginPercent,
          markupOverCostPercent: breakdown.markupOverCostPercent,
          viable: true,
          reason: null as string | null,
        };
      } catch (error) {
        if (!(error instanceof UnreachablePriceException)) {
          throw error;
        }

        return {
          marginPercent,
          price: null,
          profit: null,
          taxes: null,
          fees: null,
          effectiveMarginPercent: null,
          markupOverCostPercent: null,
          viable: false,
          reason: error.message,
        };
      }
    });

    return {
      period: fullCost.period,
      product,
      cost: new Prisma.Decimal(cost).toDecimalPlaces(MONEY_SCALE),
      percentages: this.describePercentages(percentages, source),
      scenarios: scenarios.sort((a, b) =>
        a.marginPercent.comparedTo(b.marginPercent),
      ),
      notes: this.notes(),
      caveats: fullCost.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  private async load(userId: string, filters: PricingQueryDto) {
    const { source, ...percentages } =
      await this.settingsService.resolvePercentages(userId, filters);

    const fullCost = await this.costAllocationService.getFullCost(userId, {
      from: filters.from,
      to: filters.to,
    });

    return { percentages, source, fullCost };
  }

  private priceProduct(
    item: {
      productId: string;
      productName: string;
      fullCost: Prisma.Decimal;
      directCost: Prisma.Decimal;
      allocatedIndirectCost: Prisma.Decimal;
      sellingPrice: Prisma.Decimal | null;
      hasMissingCost: boolean;
    },
    percentages: PricingPercentages,
  ) {
    const recommendedPrice = this.calculator.recommendedPrice(
      item.fullCost,
      percentages,
    );

    const currentPrice = item.sellingPrice;
    const difference =
      currentPrice === null
        ? null
        : currentPrice.sub(recommendedPrice).toDecimalPlaces(MONEY_SCALE);

    const currentBreakdown =
      currentPrice === null
        ? null
        : this.calculator.breakdown(currentPrice, item.fullCost, percentages);

    const status = this.statusFor(difference, currentBreakdown);

    return {
      productId: item.productId,
      productName: item.productName,
      fullCost: item.fullCost,
      currentPrice,
      recommendedPrice,
      difference,
      status,
      alert: this.alertFor(status),
      currentMarginPercent: currentBreakdown?.marginPercent ?? null,
      targetMarginPercent: percentages.marginPercent,
      /** Insumo nunca comprado deixa o custo subestimado e o preço, junto. */
      hasMissingCost: item.hasMissingCost,
    };
  }

  private statusFor(
    difference: Prisma.Decimal | null,
    currentBreakdown: { profit: Prisma.Decimal } | null,
  ): PriceStatus {
    if (currentBreakdown && currentBreakdown.profit.isNegative()) {
      return PriceStatus.ABAIXO_DO_CUSTO;
    }

    if (difference === null || difference.isZero()) {
      return PriceStatus.NO_RECOMENDADO;
    }

    return difference.isNegative()
      ? PriceStatus.ABAIXO_DO_RECOMENDADO
      : PriceStatus.ACIMA_DO_RECOMENDADO;
  }

  private alertFor(status: PriceStatus): string | null {
    if (status === PriceStatus.ABAIXO_DO_CUSTO) {
      return (
        'Preço abaixo do custo. Depois de imposto e taxas, esta venda dá ' +
        'prejuízo — vender mais aumenta a perda.'
      );
    }

    if (status === PriceStatus.ABAIXO_DO_RECOMENDADO) {
      return 'Preço abaixo do recomendado.';
    }

    return null;
  }

  private describePercentages(
    percentages: PricingPercentages,
    source: Record<string, 'SETTINGS' | 'QUERY'>,
  ) {
    return {
      marginPercent: percentages.marginPercent,
      taxPercent: percentages.taxPercent,
      cardFeePercent: percentages.cardFeePercent,
      deliveryFeePercent: percentages.deliveryFeePercent,
      otherFeesPercent: percentages.otherFeesPercent,
      feesPercent: this.calculator.feesPercent(percentages),
      totalPercent: this.calculator.totalPercent(percentages),
      /** De onde veio cada número: configuração gravada ou a própria consulta. */
      source,
    };
  }

  private notes() {
    return [
      'Nenhum preço foi alterado. Aplicar o preço recomendado é decisão de ' +
        'quem vende.',
      'A margem é sobre o PREÇO de venda, não sobre o custo: 30% significa ' +
        'que 30% do preço final sobra como lucro, depois de custo, imposto e ' +
        'taxa.',
      'Taxa de cartão e de delivery são somadas, o que precifica o canal mais ' +
        'caro. Para simular outro canal, informe os percentuais na consulta.',
    ];
  }
}
