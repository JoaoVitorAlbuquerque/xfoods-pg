import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

import { StockService } from 'src/modules/stock/services/stock.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { SupplyCostsService } from 'src/modules/purchases/services/supply-costs.service';
import { ExpensesService } from 'src/modules/expenses/services/expenses.service';
import { CostAllocationService } from 'src/modules/expenses/services/cost-allocation.service';
import { PricingService } from 'src/modules/pricing/services/pricing.service';
import { PricingSettingsService } from 'src/modules/pricing/services/pricing-settings.service';
import {
  PricingCalculatorService,
  PricingPercentages,
} from 'src/modules/pricing/services/pricing-calculator.service';
import {
  DateWindow,
  ProductSales,
  SalesAggregationService,
} from './sales-aggregation.service';
import { StockAggregationService } from './stock-aggregation.service';
import {
  AlertsQueryDto,
  AnalyticsQueryDto,
  ProductRanking,
  ProductRankingDto,
} from '../dto/analytics-query.dto';

const MONEY_SCALE = 2;
const PERCENT_SCALE = 2;

const DEFAULT_LIMIT = 10;

/** Referências do setor, não regras — todas sobrescrevíveis na consulta. */
const DEFAULT_HIGH_COST_PERCENT = 35;
const DEFAULT_COST_INCREASE_PERCENT = 10;
const DEFAULT_WASTE_COST = 0;

/**
 * Indicadores gerenciais.
 *
 * Tudo que depende do volume de vendas passa por agregação no banco: nenhuma
 * linha de venda ou de movimentação sobe para cá. O que a aplicação percorre é
 * do tamanho do cardápio — uma linha por produto —, e é sobre essas poucas
 * linhas que margem, lucro e ranking são calculados, porque rateio e
 * percentuais de imposto não existem no SQL.
 *
 * Nada aqui escreve. É o mesmo motivo de o módulo de preço não alterar preço:
 * um painel errado atrapalha uma decisão, não corrompe dado.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly salesAggregation: SalesAggregationService,
    private readonly stockAggregation: StockAggregationService,
    private readonly stockService: StockService,
    private readonly recipesService: RecipesService,
    private readonly supplyCostsService: SupplyCostsService,
    private readonly expensesService: ExpensesService,
    private readonly costAllocationService: CostAllocationService,
    private readonly pricingService: PricingService,
    private readonly pricingSettingsService: PricingSettingsService,
    private readonly calculator: PricingCalculatorService,
  ) {}

  // ---------------------------------------------------------------------------
  // Indicadores gerais
  // ---------------------------------------------------------------------------

  async getOverview(userId: string, filters: AnalyticsQueryDto) {
    const window = this.resolveWindow(filters);

    const [sales, allocation, percentages, stock, lossCost, consumptionCost] =
      await Promise.all([
        this.salesAggregation.totals(userId, window, filters),
        this.costAllocationService.getAllocation(userId, filters),
        this.pricingSettingsService.get(userId),
        this.stockService.getOverview(userId),
        this.stockAggregation.lossCost(userId, window, filters),
        this.stockAggregation.consumptionCost(userId, window, filters),
      ]);

    const percentagesUsed = this.percentagesFrom(percentages);
    const indirectPerUnit = allocation.costPerUnit ?? new Prisma.Decimal(0);
    const indirectAbsorbed = indirectPerUnit.mul(sales.units);

    const economics = this.economics(
      sales.revenue,
      sales.directCost,
      indirectAbsorbed,
      percentagesUsed,
    );

    return {
      period: window,
      revenue: economics.revenue,
      directCost: economics.directCost,
      indirectCost: economics.indirectCost,
      totalCost: economics.totalCost,
      taxes: economics.taxes,
      fees: economics.fees,
      estimatedProfit: economics.profit,
      marginPercent: economics.marginPercent,
      unitsSold: sales.units,
      stock: {
        value: stock.summary.totalValue,
        negative: stock.summary.negative,
        zero: stock.summary.zero,
        low: stock.summary.low,
      },
      waste: {
        /** Só perdas lançadas. O desvio não explicado está no Estimado x Real. */
        registeredLossCost: lossCost.toDecimalPlaces(MONEY_SCALE),
        consumptionCost: consumptionCost.toDecimalPlaces(MONEY_SCALE),
        lossShareOfConsumptionPercent: consumptionCost.isZero()
          ? null
          : lossCost
              .div(consumptionCost)
              .mul(100)
              .toDecimalPlaces(PERCENT_SCALE),
      },
      indirectAbsorption: this.absorption(allocation, indirectAbsorbed),
      percentages: percentagesUsed,
      dataQuality: this.dataQuality(sales),
      caveats: allocation.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Ranking de produtos
  // ---------------------------------------------------------------------------

  async getProductRanking(userId: string, filters: ProductRankingDto) {
    const { rows, window, allocation, percentages } = await this.productRows(
      userId,
      filters,
    );

    const rankBy = filters.rankBy ?? ProductRanking.REVENUE;
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const offset = filters.offset ?? 0;

    const ranked = [...rows].sort(this.comparatorFor(rankBy));

    return {
      period: window,
      rankBy,
      items: ranked.slice(offset, offset + limit),
      total: ranked.length,
      limit,
      offset,
      percentages,
      indirectCostPerUnit: allocation.costPerUnit,
      notes: [
        'Margem e lucro incluem imposto, taxas e o custo indireto rateado por ' +
          'unidade vendida.',
        'O custo direto é o congelado em cada venda, não o custo de hoje: é o ' +
          'que o prato custou quando foi vendido.',
      ],
      caveats: allocation.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Um produto
  // ---------------------------------------------------------------------------

  async getProductDetail(
    userId: string,
    productId: string,
    filters: AnalyticsQueryDto,
  ) {
    const { rows, window, allocation, percentages } = await this.productRows(
      userId,
      { ...filters, productId },
    );

    const row = rows.find((item) => item.productId === productId);

    // Preço recomendado vem do módulo de preço, que parte do custo ATUAL da
    // ficha. É outra pergunta que o custo realizado: "quanto deveria custar
    // hoje" contra "quanto custou quando vendeu".
    const pricing = await this.pricingService
      .getProductPricingDetail(userId, productId, filters)
      .catch((error) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });

    if (!row && !pricing) {
      throw new NotFoundException(
        'Product not found: it has no sales in the period and no active recipe.',
      );
    }

    const indirectPerUnit = allocation.costPerUnit ?? new Prisma.Decimal(0);

    return {
      period: window,
      productId,
      productName: row?.productName ?? pricing?.productName ?? productId,
      currentPrice: row?.currentPrice ?? pricing?.currentPrice ?? null,
      recommendedPrice: pricing?.recommendedPrice ?? null,
      priceStatus: pricing?.status ?? null,
      priceAlert: pricing?.alert ?? null,
      sales: {
        unitsSold: row?.units ?? new Prisma.Decimal(0),
        revenue: row?.revenue ?? new Prisma.Decimal(0),
        items: row?.items ?? 0,
      },
      /**
       * Economia de UMA unidade, pelo custo realizado das vendas do período.
       * Sem venda no período não há custo realizado, e a base passa a ser a
       * ficha atual — `costBasis` diz qual das duas valeu.
       *
       * Os dois caminhos devolvem exatamente os mesmos campos de propósito:
       * quem lê não deveria precisar olhar `costBasis` para saber onde está o
       * custo direto.
       */
      unitEconomics: row?.units.gt(0)
        ? {
            costBasis: 'REALIZED' as const,
            ...this.unitBreakdown(
              row.revenue.div(row.units),
              row.directCost.div(row.units),
              indirectPerUnit,
              percentages,
            ),
          }
        : pricing
          ? {
              costBasis: 'CURRENT_RECIPE' as const,
              ...this.unitBreakdown(
                new Prisma.Decimal(pricing.currentPrice ?? 0),
                new Prisma.Decimal(pricing.cost.directCost),
                new Prisma.Decimal(pricing.cost.indirectCost),
                percentages,
              ),
            }
          : null,
      periodTotals: row
        ? this.economics(
            row.revenue,
            row.directCost,
            indirectPerUnit.mul(row.units),
            percentages,
          )
        : null,
      percentages,
      dataQuality: row ? this.dataQuality(row) : null,
      caveats: allocation.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Alertas
  // ---------------------------------------------------------------------------

  async getAlerts(userId: string, filters: AlertsQueryDto) {
    const window = this.resolveWindow(filters);
    const limit = filters.limit ?? DEFAULT_LIMIT;

    const highCostThreshold = new Prisma.Decimal(
      filters.highCostThresholdPercent ?? DEFAULT_HIGH_COST_PERCENT,
    );
    const costIncreaseThreshold = new Prisma.Decimal(
      filters.costIncreaseThresholdPercent ?? DEFAULT_COST_INCREASE_PERCENT,
    );
    const wasteThreshold = new Prisma.Decimal(
      filters.wasteThresholdCost ?? DEFAULT_WASTE_COST,
    );

    const [{ rows, percentages }, pricing, withoutRecipe, variation, losses] =
      await Promise.all([
        this.productRows(userId, filters),
        this.pricingService.getProductPricing(userId, filters),
        this.recipesService.findProductsWithoutRecipe(userId),
        this.supplyCostsService.getVariationReport(userId),
        this.stockAggregation.topBySupply(userId, window, {
          types: [StockMovementType.LOSS],
          limit,
          filters,
        }),
      ]);

    const target = percentages.marginPercent;

    // Margem REALIZADA abaixo da desejada. Não é a mesma pergunta do preço
    // abaixo do recomendado: um prato pode estar no preço da tabela e mesmo
    // assim render pouco, se o insumo encareceu depois de o preço ser definido.
    const belowTargetMargin = rows
      .filter(
        (row) =>
          row.marginPercent !== null &&
          row.units.gt(0) &&
          row.marginPercent.lt(target),
      )
      .sort((a, b) => a.marginPercent.comparedTo(b.marginPercent))
      .slice(0, limit)
      .map((row) => ({
        productId: row.productId,
        productName: row.productName,
        marginPercent: row.marginPercent,
        targetMarginPercent: target,
        unitsSold: row.units,
        revenue: row.revenue,
      }));

    const belowRecommendedPrice = pricing.items
      .filter((item) => item.difference !== null && item.difference.lt(0))
      .sort((a, b) => a.difference.comparedTo(b.difference))
      .slice(0, limit)
      .map((item) => ({
        productId: item.productId,
        productName: item.productName,
        currentPrice: item.currentPrice,
        recommendedPrice: item.recommendedPrice,
        difference: item.difference,
        status: item.status,
      }));

    const highCost = pricing.items
      .filter((item) => {
        if (item.currentPrice === null || item.currentPrice.isZero()) {
          return false;
        }

        return item.fullCost
          .div(item.currentPrice)
          .mul(100)
          .gt(highCostThreshold);
      })
      .map((item) => ({
        productId: item.productId,
        productName: item.productName,
        fullCost: item.fullCost,
        currentPrice: item.currentPrice,
        costShareOfPricePercent: item.fullCost
          .div(item.currentPrice)
          .mul(100)
          .toDecimalPlaces(PERCENT_SCALE),
      }))
      .sort((a, b) =>
        b.costShareOfPricePercent.comparedTo(a.costShareOfPricePercent),
      )
      .slice(0, limit);

    const supplyCostIncrease = variation.items
      .filter(
        (item) =>
          item.variationPercent !== null &&
          new Prisma.Decimal(item.variationPercent).gt(costIncreaseThreshold),
      )
      .sort((a, b) =>
        new Prisma.Decimal(b.variationPercent).comparedTo(
          new Prisma.Decimal(a.variationPercent),
        ),
      )
      .slice(0, limit);

    const highWaste = losses.filter((loss) => loss.cost.gt(wasteThreshold));

    return {
      period: window,
      thresholds: {
        highCostPercentOfPrice: highCostThreshold,
        costIncreasePercent: costIncreaseThreshold,
        wasteCost: wasteThreshold,
        note:
          'Limiares são referências configuráveis na consulta, não regras do ' +
          'sistema.',
      },
      productsBelowTargetMargin: belowTargetMargin,
      productsBelowRecommendedPrice: belowRecommendedPrice,
      productsWithoutRecipe: withoutRecipe.items,
      productsWithHighCost: highCost,
      suppliesWithCostIncrease: supplyCostIncrease,
      suppliesWithHighWaste: highWaste,
      summary: {
        belowTargetMargin: belowTargetMargin.length,
        belowRecommendedPrice: belowRecommendedPrice.length,
        withoutRecipe: withoutRecipe.items.length,
        highCost: highCost.length,
        costIncrease: supplyCostIncrease.length,
        highWaste: highWaste.length,
      },
      notes: [
        'Margem abaixo da desejada e preço abaixo do recomendado são alertas ' +
          'diferentes: o primeiro olha o que já foi vendido, o segundo olha a ' +
          'tabela de preços contra o custo de hoje.',
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Painel de estoque
  // ---------------------------------------------------------------------------

  async getStockDashboard(userId: string, filters: AnalyticsQueryDto) {
    const window = this.resolveWindow(filters);
    const limit = filters.limit ?? DEFAULT_LIMIT;

    const [stock, topConsumption, topLosses, byType] = await Promise.all([
      this.stockService.getOverview(userId),
      this.stockAggregation.topBySupply(userId, window, {
        types: [StockMovementType.SALE, StockMovementType.PRODUCTION],
        limit,
        filters,
      }),
      this.stockAggregation.topBySupply(userId, window, {
        types: [StockMovementType.LOSS],
        limit,
        filters,
      }),
      this.stockAggregation.byType(userId, window, filters),
    ]);

    return {
      period: window,
      totalValue: stock.summary.totalValue,
      counts: {
        supplies: stock.summary.total,
        belowMinimum: stock.summary.low,
        zero: stock.summary.zero,
        negative: stock.summary.negative,
        overMaximum: stock.summary.over,
      },
      /** Insumos em situação de alerta, do mais grave ao menos grave. */
      alerts: stock.items
        .filter((item) => item.stockStatus !== 'OK')
        .slice(0, limit),
      topConsumption,
      topLosses,
      consumptionByMovementType: byType,
    };
  }

  // ---------------------------------------------------------------------------
  // Painel de custos
  // ---------------------------------------------------------------------------

  /**
   * O Estimado x Real aqui é a versão em dinheiro, por agregação.
   *
   * `SUM(recipe_total_cost)` das vendas é o que as fichas previam; o
   * `SUM(total_cost)` do razão é o que saiu. A diferença é o desvio, em duas
   * consultas — sem reabrir uma ficha sequer. A quebra por insumo, que exige
   * desdobrar receita, continua no relatório de consumo.
   */
  async getCostDashboard(userId: string, filters: AnalyticsQueryDto) {
    const window = this.resolveWindow(filters);
    const limit = filters.limit ?? DEFAULT_LIMIT;

    const [sales, allocation, byType, realConsumption, variation, percentages] =
      await Promise.all([
        this.salesAggregation.totals(userId, window, filters),
        this.costAllocationService.getAllocation(userId, filters),
        this.stockAggregation.byType(userId, window, filters),
        this.stockAggregation.consumptionCost(userId, window, filters),
        this.supplyCostsService.getVariationReport(userId),
        this.pricingSettingsService.get(userId),
      ]);

    const indirectPerUnit = allocation.costPerUnit ?? new Prisma.Decimal(0);
    const indirectAbsorbed = indirectPerUnit.mul(sales.units);
    const totalCost = sales.directCost.add(indirectAbsorbed);

    const deviation = realConsumption.sub(sales.directCost);
    const lossRow = byType.find((row) => row.type === StockMovementType.LOSS);
    const lossCost = lossRow?.cost ?? new Prisma.Decimal(0);

    return {
      period: window,
      totalCost: totalCost.toDecimalPlaces(MONEY_SCALE),
      directCost: sales.directCost.toDecimalPlaces(MONEY_SCALE),
      indirectCost: indirectAbsorbed.toDecimalPlaces(MONEY_SCALE),
      averageCostPerUnit: sales.units.isZero()
        ? null
        : totalCost.div(sales.units).toDecimalPlaces(4),
      averageDirectCostPerUnit: sales.units.isZero()
        ? null
        : sales.directCost.div(sales.units).toDecimalPlaces(4),
      estimatedVsReal: {
        estimatedConsumptionCost: sales.directCost.toDecimalPlaces(MONEY_SCALE),
        realConsumptionCost: realConsumption.toDecimalPlaces(MONEY_SCALE),
        deviationCost: deviation.toDecimalPlaces(MONEY_SCALE),
        deviationPercent: sales.directCost.isZero()
          ? null
          : deviation
              .div(sales.directCost)
              .mul(100)
              .toDecimalPlaces(PERCENT_SCALE),
        byMovementType: byType,
        note:
          'Comparação em dinheiro. A quebra por insumo, com tolerância e ' +
          'classificação, está em /consumption/by-supply.',
      },
      waste: {
        registeredLossCost: lossCost.toDecimalPlaces(MONEY_SCALE),
        shareOfConsumptionPercent: realConsumption.isZero()
          ? null
          : lossCost
              .div(realConsumption)
              .mul(100)
              .toDecimalPlaces(PERCENT_SCALE),
      },
      costVariation: {
        summary: variation.summary,
        topIncreases: variation.items
          .filter((item) => item.direction === 'UP')
          .sort((a, b) =>
            new Prisma.Decimal(b.variationPercent).comparedTo(
              new Prisma.Decimal(a.variationPercent),
            ),
          )
          .slice(0, limit),
      },
      indirectAbsorption: this.absorption(allocation, indirectAbsorbed),
      percentages: this.percentagesFrom(percentages),
      dataQuality: this.dataQuality(sales),
      caveats: allocation.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  /**
   * Uma linha por produto vendido, já com margem e lucro.
   *
   * O agrupamento é do banco; o que é percorrido aqui tem o tamanho do
   * cardápio. É esta função que os rankings, os alertas e o detalhe de produto
   * compartilham, para os três nunca discordarem sobre a margem de um prato.
   */
  private async productRows(userId: string, filters: AnalyticsQueryDto) {
    const window = this.resolveWindow(filters);

    const [sales, allocation, settings] = await Promise.all([
      this.salesAggregation.byProduct(userId, window, filters),
      this.costAllocationService.getAllocation(userId, filters),
      this.pricingSettingsService.get(userId),
    ]);

    const percentages = this.percentagesFrom(settings);
    const indirectPerUnit = allocation.costPerUnit ?? new Prisma.Decimal(0);

    const rows = sales.map((row) => {
      const indirect = indirectPerUnit.mul(row.units);
      const totals = this.economics(
        row.revenue,
        row.directCost,
        indirect,
        percentages,
      );

      return {
        // A linha agregada inteira segue junto: o detalhe de produto e os
        // alertas reutilizam esta mesma estrutura, e recortar campos aqui os
        // obrigaria a consultar o banco de novo para recuperá-los.
        ...row,
        ...totals,
        ...this.unitEconomics(row, indirectPerUnit, percentages, totals),
        dataQuality: this.dataQuality(row),
      };
    });

    return { rows, window, allocation, percentages };
  }

  private unitEconomics(
    row: ProductSales,
    indirectPerUnit: Prisma.Decimal,
    percentages: PricingPercentages,
    totals?: ReturnType<AnalyticsService['economics']>,
  ) {
    const units = row.units;

    if (units.isZero()) {
      return {
        pricePerUnit: null,
        directCostPerUnit: null,
        indirectCostPerUnit: indirectPerUnit,
        totalCostPerUnit: null,
        profitPerUnit: null,
      };
    }

    const economics =
      totals ??
      this.economics(
        row.revenue,
        row.directCost,
        indirectPerUnit.mul(units),
        percentages,
      );

    return {
      pricePerUnit: row.revenue.div(units).toDecimalPlaces(4),
      directCostPerUnit: row.directCost.div(units).toDecimalPlaces(4),
      indirectCostPerUnit: indirectPerUnit,
      totalCostPerUnit: economics.totalCost.div(units).toDecimalPlaces(4),
      profitPerUnit: economics.profit.div(units).toDecimalPlaces(4),
    };
  }

  /**
   * A economia de uma unidade: preço, custo aberto em direto e indireto,
   * imposto, taxa, lucro e margem.
   *
   * Mesma conta do total, com preço no lugar da receita — é a única forma de a
   * soma das unidades bater com o período.
   */
  private unitBreakdown(
    price: Prisma.Decimal,
    directCost: Prisma.Decimal,
    indirectCost: Prisma.Decimal,
    percentages: PricingPercentages,
  ) {
    const totalCost = directCost.add(indirectCost);
    const breakdown = this.calculator.breakdown(price, totalCost, percentages);

    return {
      price: breakdown.price,
      directCost: directCost.toDecimalPlaces(MONEY_SCALE),
      indirectCost: indirectCost.toDecimalPlaces(MONEY_SCALE),
      totalCost: breakdown.cost,
      taxes: breakdown.taxes,
      fees: breakdown.fees,
      profit: breakdown.profit,
      marginPercent: breakdown.marginPercent,
    };
  }

  /**
   * Receita menos custo, imposto e taxa.
   *
   * Reaproveita a mesma conta da formação de preço, com receita no lugar do
   * preço e custo total no lugar do custo unitário. Se o painel usasse outra
   * fórmula, a margem do relatório discordaria da margem que o preço
   * recomendado promete.
   */
  private economics(
    revenue: Prisma.Decimal,
    directCost: Prisma.Decimal,
    indirectCost: Prisma.Decimal,
    percentages: PricingPercentages,
  ) {
    const totalCost = directCost.add(indirectCost);
    const breakdown = this.calculator.breakdown(
      revenue,
      totalCost,
      percentages,
    );

    return {
      revenue: breakdown.price,
      directCost: directCost.toDecimalPlaces(MONEY_SCALE),
      indirectCost: indirectCost.toDecimalPlaces(MONEY_SCALE),
      totalCost: breakdown.cost,
      taxes: breakdown.taxes,
      fees: breakdown.fees,
      profit: breakdown.profit,
      marginPercent: breakdown.marginPercent,
    };
  }

  /**
   * Quanto da despesa do período as vendas absorveram.
   *
   * Rateio a R$ 3 esperando 3.000 vendas e vendendo 2.000 deixa R$ 3.000 sem
   * absorver — despesa real que não aparece em custo de produto nenhum. Sem
   * este número, o lucro do painel parece maior do que o do caixa.
   */
  private absorption(
    allocation: Awaited<ReturnType<CostAllocationService['getAllocation']>>,
    absorbed: Prisma.Decimal,
  ) {
    const incurred = new Prisma.Decimal(allocation.indirectCost.total);
    const difference = incurred.sub(absorbed);

    return {
      incurred: incurred.toDecimalPlaces(MONEY_SCALE),
      absorbed: absorbed.toDecimalPlaces(MONEY_SCALE),
      /** Positivo: despesa que nenhuma venda pagou. Negativo: rateio sobrando. */
      unabsorbed: difference.toDecimalPlaces(MONEY_SCALE),
      costPerUnit: allocation.costPerUnit,
    };
  }

  /**
   * Quanto do custo direto está de fato medido.
   *
   * Vendas anteriores à baixa automática e itens sem ficha não têm custo
   * congelado. Sem este aviso, o custo apareceria menor do que foi — e a
   * margem, maior.
   */
  private dataQuality(sales: {
    items: number;
    units: Prisma.Decimal;
    itemsWithoutCostSnapshot: number;
    unitsWithoutCostSnapshot: Prisma.Decimal;
  }) {
    const covered = sales.items - sales.itemsWithoutCostSnapshot;

    return {
      itemsWithCostSnapshot: covered,
      itemsWithoutCostSnapshot: sales.itemsWithoutCostSnapshot,
      unitsWithoutCostSnapshot: sales.unitsWithoutCostSnapshot,
      costCoveragePercent:
        sales.items === 0
          ? null
          : new Prisma.Decimal(covered)
              .div(sales.items)
              .mul(100)
              .toDecimalPlaces(PERCENT_SCALE),
      warning:
        sales.itemsWithoutCostSnapshot > 0
          ? `${sales.itemsWithoutCostSnapshot} item(ns) vendido(s) sem custo ` +
            'congelado: o custo direto está subestimado e a margem, ' +
            'superestimada. São vendas anteriores à baixa automática ou de ' +
            'pratos sem ficha ativa.'
          : null,
    };
  }

  private comparatorFor(rankBy: ProductRanking) {
    type Row = {
      revenue: Prisma.Decimal;
      profit: Prisma.Decimal;
      marginPercent: Prisma.Decimal | null;
      totalCost: Prisma.Decimal;
      units: Prisma.Decimal;
    };

    return (a: Row, b: Row) => {
      switch (rankBy) {
        case ProductRanking.PROFIT:
          return b.profit.comparedTo(a.profit);
        case ProductRanking.QUANTITY:
          return b.units.comparedTo(a.units);
        case ProductRanking.COST:
          return b.totalCost.comparedTo(a.totalCost);
        case ProductRanking.MARGIN_HIGH:
          return this.compareMargin(b.marginPercent, a.marginPercent);
        case ProductRanking.MARGIN_LOW:
          return this.compareMargin(a.marginPercent, b.marginPercent);
        default:
          return b.revenue.comparedTo(a.revenue);
      }
    };
  }

  /** Produto sem margem calculável fica no fim, nas duas direções. */
  private compareMargin(
    a: Prisma.Decimal | null,
    b: Prisma.Decimal | null,
  ): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;

    return a.comparedTo(b);
  }

  private percentagesFrom(settings: {
    desiredMarginPercent: Prisma.Decimal;
    taxPercent: Prisma.Decimal;
    cardFeePercent: Prisma.Decimal;
    deliveryFeePercent: Prisma.Decimal;
    otherFeesPercent: Prisma.Decimal;
  }): PricingPercentages {
    return {
      marginPercent: settings.desiredMarginPercent,
      taxPercent: settings.taxPercent,
      cardFeePercent: settings.cardFeePercent,
      deliveryFeePercent: settings.deliveryFeePercent,
      otherFeesPercent: settings.otherFeesPercent,
    };
  }

  private resolveWindow(filters: AnalyticsQueryDto): DateWindow {
    return this.expensesService.resolvePeriod({
      from: filters.from,
      to: filters.to,
    });
  }
}
