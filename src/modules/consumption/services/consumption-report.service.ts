import { Injectable } from '@nestjs/common';
import { OrderType, Prisma, SizeType, StockMovementType } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { SupplyCostingService } from 'src/modules/stock/services/supply-costing.service';
import { StockSettingsService } from 'src/modules/stock/services/stock-settings.service';
import { ORDER_ITEM_REFERENCE } from 'src/modules/orders/services/order-stock.service';
import {
  ConsumptionAnalysisService,
  ConsumptionClassification,
  CONSUMPTION_MOVEMENT_TYPES,
  DEVIATION_CAUSES,
} from './consumption-analysis.service';
import {
  ConsumptionReportDto,
  PeriodGrouping,
} from '../dto/consumption-report.dto';

const DEFAULT_PERIOD_DAYS = 30;
const MONEY_SCALE = 4;

type SupplyMeta = {
  id: string;
  name: string;
  baseUnitCode: string;
  categoryId: string | null;
  categoryName: string | null;
  unitCost: Prisma.Decimal;
};

type EstimatedLine = {
  productOrderId: string;
  productId: string;
  productName: string;
  categoryId: string | null;
  supplyId: string;
  quantity: Prisma.Decimal;
  paidAt: Date;
};

type RealLine = {
  supplyId: string;
  type: StockMovementType;
  /** Consumo positivo: o sinal do razão já foi invertido. */
  quantity: Prisma.Decimal;
  occurredAt: Date;
  productId: string | null;
};

type SoldProduct = {
  productId: string;
  productName: string;
  categoryId: string | null;
  quantity: number;
  hasRecipe: boolean;
};

/**
 * Monta o Estimado x Real.
 *
 * ESTIMADO vem das vendas e das fichas: quantidade vendida × ficha, desdobrada
 * até insumo. A ficha usada é a que foi congelada no item vendido; só quando
 * não há snapshot (venda anterior à baixa automática) cai na ficha ativa.
 * Usar a ficha do dia da venda é o que torna o número comparável — reprocessar
 * com a ficha de hoje mediria a mudança da receita, não o consumo.
 *
 * REAL vem do razão de estoque, somando as saídas do período. Como a baixa da
 * venda já nasce da ficha, a parte SALE do real tende a bater com o estimado; o
 * desvio aparece nas perdas, nos ajustes de inventário e nas vendas sem ficha.
 * É exatamente isso que o relatório precisa isolar.
 */
@Injectable()
export class ConsumptionReportService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recipesService: RecipesService,
    private readonly supplyCostingService: SupplyCostingService,
    private readonly stockSettingsService: StockSettingsService,
    private readonly analysis: ConsumptionAnalysisService,
  ) {}

  // ---------------------------------------------------------------------------
  // 1. Estimado x Real por insumo
  // ---------------------------------------------------------------------------

  async bySupply(userId: string, filters: ConsumptionReportDto) {
    const data = await this.collect(userId, filters);
    const rows = this.buildSupplyRows(data);

    return {
      period: data.period,
      filters: data.appliedFilters,
      items: [...rows].sort((a, b) => a.supplyName.localeCompare(b.supplyName)),
      summary: this.summarize(rows, data),
      interpretation: this.interpretation(data),
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Estimado x Real por produto
  // ---------------------------------------------------------------------------

  /**
   * O mesmo confronto, quebrado por prato.
   *
   * Uma perda de estoque não sabe de qual prato veio: LOSS e ADJUSTMENT não
   * têm produto. Então cada linha traz o que é medido e o que é rateado
   * separado — `realAttributed` sai das movimentações da própria venda,
   * `allocatedDeviation` é a fatia do desvio sem dono, distribuída na proporção
   * do consumo previsto. Somando os dois por insumo, volta exatamente o real
   * do relatório por insumo.
   */
  async byProduct(userId: string, filters: ConsumptionReportDto) {
    const data = await this.collect(userId, filters);

    const estimatedBySupply = new Map<string, Prisma.Decimal>();
    const estimatedByPair = new Map<string, Prisma.Decimal>();
    const attributedByPair = new Map<string, Prisma.Decimal>();
    const attributedBySupply = new Map<string, Prisma.Decimal>();
    const realBySupply = new Map<string, Prisma.Decimal>();

    const pair = (productId: string, supplyId: string) =>
      `${productId}|${supplyId}`;

    for (const line of data.estimated) {
      const key = pair(line.productId, line.supplyId);

      estimatedByPair.set(
        key,
        (estimatedByPair.get(key) ?? new Prisma.Decimal(0)).add(line.quantity),
      );
      estimatedBySupply.set(
        line.supplyId,
        (estimatedBySupply.get(line.supplyId) ?? new Prisma.Decimal(0)).add(
          line.quantity,
        ),
      );
    }

    for (const line of data.real) {
      realBySupply.set(
        line.supplyId,
        (realBySupply.get(line.supplyId) ?? new Prisma.Decimal(0)).add(
          line.quantity,
        ),
      );

      if (!line.productId) continue;

      const key = pair(line.productId, line.supplyId);

      attributedByPair.set(
        key,
        (attributedByPair.get(key) ?? new Prisma.Decimal(0)).add(line.quantity),
      );
      attributedBySupply.set(
        line.supplyId,
        (attributedBySupply.get(line.supplyId) ?? new Prisma.Decimal(0)).add(
          line.quantity,
        ),
      );
    }

    const items = [];
    let unallocatedCost = new Prisma.Decimal(0);

    for (const [key, estimated] of estimatedByPair) {
      const [productId, supplyId] = key.split('|');
      const supply = data.supplies.get(supplyId);
      const product = data.sold.get(productId);

      const supplyEstimated =
        estimatedBySupply.get(supplyId) ?? new Prisma.Decimal(0);
      const unattributed = (
        realBySupply.get(supplyId) ?? new Prisma.Decimal(0)
      ).sub(attributedBySupply.get(supplyId) ?? new Prisma.Decimal(0));

      // Rateio proporcional ao consumo previsto. Com estimativa zero para o
      // insumo inteiro não há proporção possível, e o desvio fica de fora —
      // contabilizado à parte para o total continuar fechando.
      const share = supplyEstimated.isZero()
        ? new Prisma.Decimal(0)
        : estimated.div(supplyEstimated);

      const allocated = unattributed.mul(share);
      const attributed =
        attributedByPair.get(key) ?? new Prisma.Decimal(0);

      const comparison = this.analysis.compare({
        estimatedQuantity: estimated,
        realQuantity: attributed.add(allocated),
        unitCost: supply.unitCost,
        tolerancePercent: data.tolerance,
      });

      items.push({
        productId,
        productName: product?.productName ?? productId,
        supplyId,
        supplyName: supply.name,
        baseUnit: supply.baseUnitCode,
        quantitySold: product?.quantity ?? 0,
        estimatedQuantity: comparison.estimatedQuantity,
        realQuantity: comparison.realQuantity,
        difference: comparison.difference,
        variationPercent: comparison.variationPercent,
        classification: comparison.classification,
        unitCost: comparison.unitCost,
        differenceCost: comparison.differenceCost,
        attribution: {
          realAttributed: attributed,
          allocatedDeviation: allocated,
          note:
            'realAttributed sai das movimentações desta venda; ' +
            'allocatedDeviation é rateio do desvio sem produto identificado.',
        },
      });
    }

    for (const [supplyId, supplyEstimated] of estimatedBySupply) {
      if (!supplyEstimated.isZero()) continue;

      const supply = data.supplies.get(supplyId);
      const unattributed = (
        realBySupply.get(supplyId) ?? new Prisma.Decimal(0)
      ).sub(attributedBySupply.get(supplyId) ?? new Prisma.Decimal(0));

      unallocatedCost = unallocatedCost.add(unattributed.mul(supply.unitCost));
    }

    // Insumos que só aparecem no real: consumidos sem nenhuma venda prevendo.
    for (const [supplyId, real] of realBySupply) {
      if (estimatedBySupply.has(supplyId)) continue;

      const supply = data.supplies.get(supplyId);
      unallocatedCost = unallocatedCost.add(real.mul(supply.unitCost));
    }

    return {
      period: data.period,
      filters: data.appliedFilters,
      items: items.sort(
        (a, b) =>
          a.productName.localeCompare(b.productName) ||
          a.supplyName.localeCompare(b.supplyName),
      ),
      summary: {
        products: data.sold.size,
        rows: items.length,
        differenceCost: items.reduce(
          (total, item) => total.add(item.differenceCost),
          new Prisma.Decimal(0),
        ),
        // Desvio que não coube em nenhum prato porque nenhuma venda previa
        // aquele insumo no período. Fica visível em vez de sumir no rateio.
        unallocatedDeviationCost: unallocatedCost.toDecimalPlaces(MONEY_SCALE),
      },
      interpretation: this.interpretation(data),
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Maiores desvios
  // ---------------------------------------------------------------------------

  async topDeviations(userId: string, filters: ConsumptionReportDto) {
    const data = await this.collect(userId, filters);

    const rows = this.buildSupplyRows(data)
      .filter(
        (row) =>
          row.classification !== ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      )
      .sort((a, b) => this.analysis.bySeverity(a, b))
      .slice(0, filters.limit ?? 20);

    return {
      period: data.period,
      filters: data.appliedFilters,
      tolerancePercent: data.tolerance,
      items: rows,
      interpretation: this.interpretation(data),
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Maiores perdas financeiras
  // ---------------------------------------------------------------------------

  /**
   * Só o que custou dinheiro. Consumo abaixo do previsto fica de fora: pode ser
   * boa notícia ou ficha errada, mas não é perda, e misturar os dois esconderia
   * o insumo que realmente está drenando caixa.
   */
  async topFinancialLosses(userId: string, filters: ConsumptionReportDto) {
    const data = await this.collect(userId, filters);

    const rows = this.buildSupplyRows(data)
      .filter((row) => row.differenceCost.gt(0))
      .sort((a, b) => b.differenceCost.comparedTo(a.differenceCost))
      .slice(0, filters.limit ?? 20);

    return {
      period: data.period,
      filters: data.appliedFilters,
      items: rows,
      summary: {
        totalLossCost: rows.reduce(
          (total, row) => total.add(row.differenceCost),
          new Prisma.Decimal(0),
        ),
      },
      interpretation: this.interpretation(data),
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Desperdício por período
  // ---------------------------------------------------------------------------

  async wasteByPeriod(userId: string, filters: ConsumptionReportDto) {
    const data = await this.collect(userId, filters);
    const grouping = filters.groupBy ?? PeriodGrouping.DAY;

    type Bucket = {
      bucket: string;
      estimatedCost: Prisma.Decimal;
      realCost: Prisma.Decimal;
      byType: Map<StockMovementType, Prisma.Decimal>;
    };

    const buckets = new Map<string, Bucket>();

    const bucketFor = (date: Date) => {
      const key = this.bucketKey(date, grouping);
      const existing = buckets.get(key);

      if (existing) return existing;

      const created: Bucket = {
        bucket: key,
        estimatedCost: new Prisma.Decimal(0),
        realCost: new Prisma.Decimal(0),
        byType: new Map(),
      };

      buckets.set(key, created);

      return created;
    };

    for (const line of data.estimated) {
      const supply = data.supplies.get(line.supplyId);
      const bucket = bucketFor(line.paidAt);

      bucket.estimatedCost = bucket.estimatedCost.add(
        line.quantity.mul(supply.unitCost),
      );
    }

    for (const line of data.real) {
      const supply = data.supplies.get(line.supplyId);
      const bucket = bucketFor(line.occurredAt);
      const cost = line.quantity.mul(supply.unitCost);

      bucket.realCost = bucket.realCost.add(cost);
      bucket.byType.set(
        line.type,
        (bucket.byType.get(line.type) ?? new Prisma.Decimal(0)).add(cost),
      );
    }

    const items = [...buckets.values()]
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((bucket) => {
        const differenceCost = bucket.realCost.sub(bucket.estimatedCost);

        return {
          bucket: bucket.bucket,
          estimatedCost: bucket.estimatedCost.toDecimalPlaces(MONEY_SCALE),
          realCost: bucket.realCost.toDecimalPlaces(MONEY_SCALE),
          differenceCost: differenceCost.toDecimalPlaces(MONEY_SCALE),
          wastePercent: this.analysis.wastePercent(
            bucket.estimatedCost,
            differenceCost,
          ),
          costByMovementType: Object.fromEntries(
            [...bucket.byType.entries()].map(([type, cost]) => [
              type,
              cost.toDecimalPlaces(MONEY_SCALE),
            ]),
          ),
        };
      });

    return {
      period: data.period,
      filters: data.appliedFilters,
      groupBy: grouping,
      items,
      interpretation: this.interpretation(data),
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Painel
  // ---------------------------------------------------------------------------

  /**
   * Totais em dinheiro, não em quantidade: grama, mililitro e unidade não se
   * somam, e um painel que somasse 200 g com 2 UN mostraria 202 do quê?
   */
  async dashboard(userId: string, filters: ConsumptionReportDto) {
    const data = await this.collect(userId, filters);
    const rows = this.buildSupplyRows(data);

    const estimatedCost = rows.reduce(
      (total, row) => total.add(row.estimatedCost),
      new Prisma.Decimal(0),
    );
    const realCost = rows.reduce(
      (total, row) => total.add(row.realCost),
      new Prisma.Decimal(0),
    );
    const differenceCost = realCost.sub(estimatedCost);

    const above = rows.filter((row) => row.differenceCost.gt(0));
    const below = rows.filter((row) => row.differenceCost.lt(0));

    return {
      period: data.period,
      filters: data.appliedFilters,
      tolerancePercent: data.tolerance,
      estimatedConsumptionCost: estimatedCost.toDecimalPlaces(MONEY_SCALE),
      realConsumptionCost: realCost.toDecimalPlaces(MONEY_SCALE),
      /** Saldo líquido: sobras de um insumo abatem faltas de outro. */
      totalDeviationCost: differenceCost.toDecimalPlaces(MONEY_SCALE),
      deviationCost: {
        // Bruto, sem compensação: +10 num insumo e −10 em outro somam zero no
        // líquido, mas são dois problemas para apurar, não nenhum.
        aboveExpected: above
          .reduce((total, row) => total.add(row.differenceCost), new Prisma.Decimal(0))
          .toDecimalPlaces(MONEY_SCALE),
        belowExpected: below
          .reduce((total, row) => total.add(row.differenceCost), new Prisma.Decimal(0))
          .toDecimalPlaces(MONEY_SCALE),
        gross: rows
          .reduce(
            (total, row) => total.add(row.differenceCost.abs()),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(MONEY_SCALE),
      },
      wastePercent: this.analysis.wastePercent(estimatedCost, differenceCost),
      counts: {
        supplies: rows.length,
        aboveExpected: rows.filter(
          (row) =>
            row.classification === ConsumptionClassification.ACIMA_DO_ESPERADO,
        ).length,
        withinTolerance: rows.filter(
          (row) =>
            row.classification ===
            ConsumptionClassification.DENTRO_DA_TOLERANCIA,
        ).length,
        belowExpected: rows.filter(
          (row) =>
            row.classification === ConsumptionClassification.ABAIXO_DO_ESPERADO,
        ).length,
        productsSold: data.sold.size,
        productsWithoutRecipe: data.productsWithoutRecipe.length,
      },
      interpretation: this.interpretation(data),
    };
  }

  // ---------------------------------------------------------------------------
  // Montagem das linhas
  // ---------------------------------------------------------------------------

  private buildSupplyRows(data: CollectedData) {
    const estimatedBySupply = new Map<string, Prisma.Decimal>();
    const realBySupply = new Map<string, Prisma.Decimal>();
    const byType = new Map<string, Map<StockMovementType, Prisma.Decimal>>();

    for (const line of data.estimated) {
      estimatedBySupply.set(
        line.supplyId,
        (estimatedBySupply.get(line.supplyId) ?? new Prisma.Decimal(0)).add(
          line.quantity,
        ),
      );
    }

    for (const line of data.real) {
      realBySupply.set(
        line.supplyId,
        (realBySupply.get(line.supplyId) ?? new Prisma.Decimal(0)).add(
          line.quantity,
        ),
      );

      const types = byType.get(line.supplyId) ?? new Map();
      types.set(
        line.type,
        (types.get(line.type) ?? new Prisma.Decimal(0)).add(line.quantity),
      );
      byType.set(line.supplyId, types);
    }

    const supplyIds = new Set([
      ...estimatedBySupply.keys(),
      ...realBySupply.keys(),
    ]);

    return [...supplyIds].map((supplyId) => {
      const supply = data.supplies.get(supplyId);
      const types = byType.get(supplyId) ?? new Map();

      const comparison = this.analysis.compare({
        estimatedQuantity: estimatedBySupply.get(supplyId) ?? 0,
        realQuantity: realBySupply.get(supplyId) ?? 0,
        unitCost: supply.unitCost,
        tolerancePercent: data.tolerance,
      });

      return {
        supplyId,
        supplyName: supply.name,
        supplyCategory: supply.categoryName,
        baseUnit: supply.baseUnitCode,
        ...comparison,
        realByMovementType: Object.fromEntries(types.entries()),
        deviationBreakdown: this.analysis.explainDeviation(
          comparison.difference,
          Object.fromEntries(types.entries()),
        ),
      };
    });
  }

  private summarize(
    rows: ReturnType<ConsumptionReportService['buildSupplyRows']>,
    data: CollectedData,
  ) {
    const estimatedCost = rows.reduce(
      (total, row) => total.add(row.estimatedCost),
      new Prisma.Decimal(0),
    );
    const realCost = rows.reduce(
      (total, row) => total.add(row.realCost),
      new Prisma.Decimal(0),
    );
    const differenceCost = realCost.sub(estimatedCost);

    return {
      supplies: rows.length,
      // Produto vendido sem ficha não gera consumo previsto: a lista fica no
      // resumo porque é a primeira coisa a corrigir quando o desvio não fecha.
      productsWithoutRecipe: data.productsWithoutRecipe,
      estimatedCost: estimatedCost.toDecimalPlaces(MONEY_SCALE),
      realCost: realCost.toDecimalPlaces(MONEY_SCALE),
      differenceCost: differenceCost.toDecimalPlaces(MONEY_SCALE),
      wastePercent: this.analysis.wastePercent(estimatedCost, differenceCost),
      tolerancePercent: data.tolerance,
      byClassification: {
        ACIMA_DO_ESPERADO: rows.filter(
          (row) =>
            row.classification === ConsumptionClassification.ACIMA_DO_ESPERADO,
        ).length,
        DENTRO_DA_TOLERANCIA: rows.filter(
          (row) =>
            row.classification ===
            ConsumptionClassification.DENTRO_DA_TOLERANCIA,
        ).length,
        ABAIXO_DO_ESPERADO: rows.filter(
          (row) =>
            row.classification === ConsumptionClassification.ABAIXO_DO_ESPERADO,
        ).length,
      },
    };
  }

  /**
   * Vai em toda resposta. O relatório mostra uma diferença, não um diagnóstico:
   * quem lê precisa ter as causas possíveis à mão antes de concluir que a
   * cozinha está desperdiçando.
   */
  private interpretation(data: CollectedData) {
    return {
      warning:
        'Diferença entre estimado e real não é automaticamente desperdício. ' +
        'Confira as causas possíveis e o detalhamento por tipo de movimentação ' +
        'antes de concluir.',
      possibleCauses: DEVIATION_CAUSES,
      caveats: data.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Coleta
  // ---------------------------------------------------------------------------

  private async collect(
    userId: string,
    filters: ConsumptionReportDto,
  ): Promise<CollectedData> {
    const period = this.resolvePeriod(filters);
    const tolerance = await this.stockSettingsService.consumptionTolerance(
      userId,
    );

    const caveats: string[] = [];
    const filtersProduct = Boolean(filters.productId || filters.categoryId);

    // ---- lado estimado: vendas do período × ficha ---------------------------

    const soldItems = await this.prismaService.productOrder.findMany({
      where: {
        userId,
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.categoryId
          ? { product: { categoryId: filters.categoryId } }
          : {}),
        order: {
          userId,
          paid: true,
          deletedAt: null,
          // Venda cancelada teve o estoque estornado; deixá-la no estimado
          // criaria uma diferença que já foi desfeita no razão.
          status: { not: OrderType.CANCELED },
          paidAt: { gte: period.from, lte: period.to },
        },
      },
      select: {
        id: true,
        productId: true,
        quantity: true,
        size: true,
        recipeId: true,
        order: { select: { paidAt: true } },
        product: {
          select: { id: true, name: true, categoryId: true },
        },
      },
    });

    const estimated: EstimatedLine[] = [];
    const sold = new Map<string, SoldProduct>();
    const productsWithoutRecipe = new Map<string, string>();

    const perDishCache = new Map<
      string,
      { supplyId: string; quantityBase: Prisma.Decimal }[]
    >();
    const activeRecipeCache = new Map<string, string | null>();

    for (const item of soldItems) {
      const recipeId = await this.resolveRecipeId(
        userId,
        item.recipeId,
        item.productId,
        activeRecipeCache,
      );

      const current = sold.get(item.productId) ?? {
        productId: item.productId,
        productName: item.product.name,
        categoryId: item.product.categoryId,
        quantity: 0,
        hasRecipe: Boolean(recipeId),
      };

      current.quantity += item.quantity;
      current.hasRecipe = current.hasRecipe || Boolean(recipeId);
      sold.set(item.productId, current);

      if (!recipeId) {
        // Vendeu e não previu consumo nenhum. Some do estimado, aparece no
        // real (ou nem isso), e é uma das causas mais comuns de desvio.
        productsWithoutRecipe.set(item.productId, item.product.name);
        continue;
      }

      const perDish = await this.perDish(
        userId,
        recipeId,
        item.size,
        perDishCache,
      );

      for (const line of perDish) {
        estimated.push({
          productOrderId: item.id,
          productId: item.productId,
          productName: item.product.name,
          categoryId: item.product.categoryId,
          supplyId: line.supplyId,
          quantity: line.quantityBase.mul(item.quantity),
          paidAt: item.order.paidAt,
        });
      }
    }

    // ---- lado real: razão de estoque ---------------------------------------

    const types = filters.movementTypes?.length
      ? filters.movementTypes
      : CONSUMPTION_MOVEMENT_TYPES;

    if (filters.movementTypes?.length) {
      caveats.push(
        'O consumo real foi restrito aos tipos ' +
          `${types.join(', ')}: a comparação deixa de medir o consumo total.`,
      );
    }

    // Com filtro de produto, o real só pode considerar o que tem produto
    // identificável — perda e ajuste de inventário não sabem de qual prato
    // vieram. O relatório fica coerente, mas deixa de enxergar esses desvios.
    const attributedOnly = filtersProduct;

    if (attributedOnly) {
      caveats.push(
        'Filtro por produto ou categoria aplicado: o consumo real conta apenas ' +
          'movimentações ligadas às vendas desses produtos. Perdas, ajustes de ' +
          'inventário e produção não têm produto identificado e ficam de fora.',
      );
    }

    const movements = await this.prismaService.stockMovement.findMany({
      where: {
        userId,
        type: { in: types },
        occurredAt: { gte: period.from, lte: period.to },
        ...(filters.supplyId ? { supplyId: filters.supplyId } : {}),
        ...(filters.supplyCategoryId
          ? { supply: { supplyCategoryId: filters.supplyCategoryId } }
          : {}),
        ...(attributedOnly
          ? {
              referenceType: ORDER_ITEM_REFERENCE,
              referenceId: { in: soldItems.map((item) => item.id) },
            }
          : {}),
      },
      select: {
        supplyId: true,
        type: true,
        quantityBase: true,
        occurredAt: true,
        referenceType: true,
        referenceId: true,
      },
    });

    const orderItemIds = movements
      .filter(
        (movement) =>
          movement.referenceType === ORDER_ITEM_REFERENCE && movement.referenceId,
      )
      .map((movement) => movement.referenceId);

    const itemToProduct = await this.mapItemsToProducts(userId, orderItemIds);

    const real: RealLine[] = movements.map((movement) => ({
      supplyId: movement.supplyId,
      type: movement.type,
      // O razão guarda saída como negativo; consumo é a leitura invertida.
      quantity: new Prisma.Decimal(movement.quantityBase).neg(),
      occurredAt: movement.occurredAt,
      productId:
        movement.referenceType === ORDER_ITEM_REFERENCE
          ? itemToProduct.get(movement.referenceId) ?? null
          : null,
    }));

    // ---- metadados dos insumos e filtro por insumo --------------------------

    const supplyIds = new Set([
      ...estimated.map((line) => line.supplyId),
      ...real.map((line) => line.supplyId),
    ]);

    const supplies = await this.loadSupplies(userId, [...supplyIds]);

    const keepSupply = (supplyId: string) => {
      const supply = supplies.get(supplyId);

      if (!supply) return false;
      if (filters.supplyId && supply.id !== filters.supplyId) return false;
      if (
        filters.supplyCategoryId &&
        supply.categoryId !== filters.supplyCategoryId
      ) {
        return false;
      }

      return true;
    };

    await this.flagCrossPeriodReversals(userId, period, caveats);

    if (productsWithoutRecipe.size > 0) {
      caveats.push(
        `${productsWithoutRecipe.size} produto(s) vendido(s) sem ficha ativa: ` +
          'o consumo previsto deles é zero, o que puxa o desvio para cima.',
      );
    }

    return {
      period,
      tolerance,
      estimated: estimated.filter((line) => keepSupply(line.supplyId)),
      real: real.filter((line) => keepSupply(line.supplyId)),
      supplies,
      sold,
      productsWithoutRecipe: [...productsWithoutRecipe.entries()].map(
        ([productId, name]) => ({ productId, name }),
      ),
      caveats,
      appliedFilters: {
        productId: filters.productId ?? null,
        categoryId: filters.categoryId ?? null,
        supplyId: filters.supplyId ?? null,
        supplyCategoryId: filters.supplyCategoryId ?? null,
        movementTypes: types,
        realScope: attributedOnly ? 'ATTRIBUTED_TO_PRODUCTS' : 'ALL_MOVEMENTS',
      },
    };
  }

  /**
   * Um estorno lançado depois do fim do período deixa o consumo dentro dele e a
   * devolução fora. O número não fica errado — o lançamento é do dia em que
   * aconteceu —, mas quem lê precisa saber que aquele desvio já foi desfeito.
   */
  private async flagCrossPeriodReversals(
    userId: string,
    period: { from: Date; to: Date },
    caveats: string[],
  ) {
    const [reversedLater, reversingEarlier] = await Promise.all([
      this.prismaService.stockMovement.count({
        where: {
          userId,
          type: StockMovementType.SALE,
          occurredAt: { gte: period.from, lte: period.to },
          reversedBy: { is: { occurredAt: { gt: period.to } } },
        },
      }),
      this.prismaService.stockMovement.count({
        where: {
          userId,
          type: StockMovementType.RETURN,
          occurredAt: { gte: period.from, lte: period.to },
          reversalOf: { is: { occurredAt: { lt: period.from } } },
        },
      }),
    ]);

    if (reversedLater > 0) {
      caveats.push(
        `${reversedLater} consumo(s) deste período foram estornados depois do ` +
          'fim dele: aparecem aqui como consumo, e a devolução caiu no período seguinte.',
      );
    }

    if (reversingEarlier > 0) {
      caveats.push(
        `${reversingEarlier} estorno(s) deste período devolvem consumo de ` +
          'antes do início dele, reduzindo o consumo real medido aqui.',
      );
    }
  }

  private async mapItemsToProducts(userId: string, itemIds: string[]) {
    const map = new Map<string, string>();

    if (itemIds.length === 0) return map;

    const items = await this.prismaService.productOrder.findMany({
      where: { userId, id: { in: [...new Set(itemIds)] } },
      select: { id: true, productId: true },
    });

    for (const item of items) {
      map.set(item.id, item.productId);
    }

    return map;
  }

  private async loadSupplies(userId: string, supplyIds: string[]) {
    const map = new Map<string, SupplyMeta>();

    if (supplyIds.length === 0) return map;

    const supplies = await this.prismaService.supply.findMany({
      where: { userId, id: { in: supplyIds } },
      select: {
        id: true,
        name: true,
        supplyCategoryId: true,
        costingMethod: true,
        lastCost: true,
        averageCost: true,
        baseUnit: { select: { code: true } },
        category: { select: { name: true } },
      },
    });

    for (const supply of supplies) {
      map.set(supply.id, {
        id: supply.id,
        name: supply.name,
        baseUnitCode: supply.baseUnit.code,
        categoryId: supply.supplyCategoryId,
        categoryName: supply.category?.name ?? null,
        // Estimado, real e diferença são valorizados pelo mesmo custo atual,
        // como o escopo define. Assim a diferença em dinheiro reflete só a
        // diferença de quantidade, sem embutir variação de preço.
        unitCost: this.supplyCostingService.getCurrentUnitCost(supply),
      });
    }

    return map;
  }

  /** Ficha congelada na venda; sem ela, a ficha ativa de hoje. */
  private async resolveRecipeId(
    userId: string,
    snapshotRecipeId: string | null,
    productId: string,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (snapshotRecipeId) return snapshotRecipeId;

    if (cache.has(productId)) return cache.get(productId);

    const recipe = await this.prismaService.recipe.findFirst({
      where: { userId, productId, active: true },
      select: { id: true },
    });

    cache.set(productId, recipe?.id ?? null);

    return recipe?.id ?? null;
  }

  /**
   * Consumo de uma unidade do prato no tamanho vendido, já desdobrado em
   * insumos. Em cache porque um mês de vendas repete a mesma ficha centenas de
   * vezes, e cada desdobramento é uma ida ao banco.
   */
  private async perDish(
    userId: string,
    recipeId: string,
    size: SizeType,
    cache: Map<string, { supplyId: string; quantityBase: Prisma.Decimal }[]>,
  ) {
    const key = `${recipeId}|${size}`;
    const cached = cache.get(key);

    if (cached) return cached;

    const recipe = await this.prismaService.recipe.findFirst({
      where: { id: recipeId, userId },
      select: { sizeFactors: { select: { size: true, factor: true } } },
    });

    const factor = this.recipesService.sizeFactorFor(
      recipe?.sizeFactors ?? [],
      size,
    );

    const exploded = await this.recipesService.explodeToSupplies(
      userId,
      recipeId,
      factor,
    );

    const lines = exploded.map((line) => ({
      supplyId: line.supplyId,
      quantityBase: line.quantityBase,
    }));

    cache.set(key, lines);

    return lines;
  }

  private resolvePeriod(filters: ConsumptionReportDto) {
    const to = filters.to ? new Date(filters.to) : new Date();
    const from = filters.from
      ? new Date(filters.from)
      : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    return { from, to };
  }

  /**
   * Chave do agrupamento, em horário local: quem lê o relatório pensa em
   * "ontem" pelo relógio do salão, não em UTC.
   */
  private bucketKey(date: Date, grouping: PeriodGrouping) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');

    if (grouping === PeriodGrouping.MONTH) {
      return `${year}-${month}`;
    }

    if (grouping === PeriodGrouping.WEEK) {
      // Segunda-feira da semana, para a chave ordenar como texto.
      const monday = new Date(date);
      const weekday = (monday.getDay() + 6) % 7;

      monday.setDate(monday.getDate() - weekday);

      return (
        `${monday.getFullYear()}-` +
        `${`${monday.getMonth() + 1}`.padStart(2, '0')}-` +
        `${`${monday.getDate()}`.padStart(2, '0')}`
      );
    }

    return `${year}-${month}-${day}`;
  }
}

type CollectedData = {
  period: { from: Date; to: Date };
  tolerance: Prisma.Decimal;
  estimated: EstimatedLine[];
  real: RealLine[];
  supplies: Map<string, SupplyMeta>;
  sold: Map<string, SoldProduct>;
  productsWithoutRecipe: { productId: string; name: string }[];
  caveats: string[];
  appliedFilters: Record<string, unknown>;
};
