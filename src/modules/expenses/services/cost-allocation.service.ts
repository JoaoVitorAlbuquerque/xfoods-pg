import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  AllocationMethod,
  AllocationPeriod,
  OrderType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { ExpensesService } from './expenses.service';
import {
  DateWindow,
  ExpenseRecurrenceService,
} from './expense-recurrence.service';
import { ExpensePeriodDto } from '../dto/list-expenses.dto';
import { UpdateCostAllocationSettingsDto } from '../dto/cost-allocation-settings.dto';

const MONEY_SCALE = 2;
const UNIT_COST_SCALE = 4;

const DEFAULTS = {
  method: AllocationMethod.PER_SOLD_UNIT,
  referencePeriod: AllocationPeriod.MONTHLY,
  estimatedSalesUnits: 0,
  estimatedRevenue: 0,
  includeFixed: true,
  includeVariable: true,
};

/**
 * Transforma despesa operacional em custo por unidade vendida.
 *
 * O custo direto já vem da ficha técnica; o que falta para o custo completo é
 * a parcela do aluguel, da energia e do contador que cada prato carrega. Este
 * serviço só calcula: nada aqui altera preço de venda, que é assunto da
 * formação de preço.
 */
@Injectable()
export class CostAllocationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly expensesService: ExpensesService,
    private readonly recipesService: RecipesService,
    private readonly recurrenceService: ExpenseRecurrenceService,
  ) {}

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------

  /** Ausência de registro significa padrões, não "usuário sem configuração". */
  async getSettings(userId: string) {
    const settings = await this.prismaService.costAllocationSettings.findUnique({
      where: { userId },
    });

    return {
      method: settings?.method ?? DEFAULTS.method,
      referencePeriod: settings?.referencePeriod ?? DEFAULTS.referencePeriod,
      estimatedSalesUnits: new Prisma.Decimal(
        settings?.estimatedSalesUnits ?? DEFAULTS.estimatedSalesUnits,
      ),
      estimatedRevenue: new Prisma.Decimal(
        settings?.estimatedRevenue ?? DEFAULTS.estimatedRevenue,
      ),
      includeFixed: settings?.includeFixed ?? DEFAULTS.includeFixed,
      includeVariable: settings?.includeVariable ?? DEFAULTS.includeVariable,
      updatedAt: settings?.updatedAt ?? null,
    };
  }

  async updateSettings(userId: string, dto: UpdateCostAllocationSettingsDto) {
    const settings = await this.prismaService.costAllocationSettings.upsert({
      where: { userId },
      create: {
        userId,
        method: dto.method ?? DEFAULTS.method,
        referencePeriod: dto.referencePeriod ?? DEFAULTS.referencePeriod,
        estimatedSalesUnits: new Prisma.Decimal(
          dto.estimatedSalesUnits ?? DEFAULTS.estimatedSalesUnits,
        ),
        estimatedRevenue: new Prisma.Decimal(
          dto.estimatedRevenue ?? DEFAULTS.estimatedRevenue,
        ),
        includeFixed: dto.includeFixed ?? DEFAULTS.includeFixed,
        includeVariable: dto.includeVariable ?? DEFAULTS.includeVariable,
      },
      update: {
        ...(dto.method === undefined ? {} : { method: dto.method }),
        ...(dto.referencePeriod === undefined
          ? {}
          : { referencePeriod: dto.referencePeriod }),
        ...(dto.estimatedSalesUnits === undefined
          ? {}
          : {
              estimatedSalesUnits: new Prisma.Decimal(dto.estimatedSalesUnits),
            }),
        ...(dto.estimatedRevenue === undefined
          ? {}
          : { estimatedRevenue: new Prisma.Decimal(dto.estimatedRevenue) }),
        ...(dto.includeFixed === undefined
          ? {}
          : { includeFixed: dto.includeFixed }),
        ...(dto.includeVariable === undefined
          ? {}
          : { includeVariable: dto.includeVariable }),
      },
    });

    return this.getSettings(userId);
  }

  // ---------------------------------------------------------------------------
  // Rateio
  // ---------------------------------------------------------------------------

  async getAllocation(userId: string, filters: ExpensePeriodDto) {
    const window = this.expensesService.resolvePeriod(filters);
    const settings = await this.getSettings(userId);
    const caveats: string[] = [];

    const expanded = await this.expensesService.expandForPeriod(userId, window, {
      onlyIncludedInAllocation: true,
      onlyIndirect: true,
      includeFixed: settings.includeFixed,
      includeVariable: settings.includeVariable,
    });

    const indirectTotal = expanded
      .reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0))
      .toDecimalPlaces(MONEY_SCALE);

    // A estimativa é por período de referência: um relatório de trimestre com
    // referência mensal espera três vezes o volume, senão o custo por unidade
    // triplicaria só porque a janela ficou maior.
    const periods = this.recurrenceService.referencePeriodsIn(
      window,
      settings.referencePeriod,
    );

    const estimatedUnits = settings.estimatedSalesUnits.mul(periods);
    const actual = await this.actualSales(userId, window);

    if (periods > 1) {
      caveats.push(
        `A janela cobre ${periods} período(s) de referência ` +
          `(${settings.referencePeriod}): a estimativa foi multiplicada por ${periods}.`,
      );
    }

    const divisor = this.divisorFor(settings.method, estimatedUnits);

    if (divisor.isZero()) {
      caveats.push(
        'Vendas estimadas não configuradas: sem divisor não há custo por ' +
          'unidade. Informe estimatedSalesUnits na configuração de rateio.',
      );
    }

    const costPerUnit = divisor.isZero()
      ? null
      : indirectTotal.div(divisor).toDecimalPlaces(UNIT_COST_SCALE);

    const costPerUnitByActualSales = actual.units.isZero()
      ? null
      : indirectTotal.div(actual.units).toDecimalPlaces(UNIT_COST_SCALE);

    if (
      costPerUnit !== null &&
      costPerUnitByActualSales !== null &&
      !costPerUnit.equals(costPerUnitByActualSales)
    ) {
      caveats.push(
        `A estimativa (${estimatedUnits.toString()} un) difere das vendas ` +
          `reais do período (${actual.units.toString()} un). O custo por ` +
          'unidade calculado usa a estimativa; o valor pelas vendas reais vem ' +
          'em costPerUnitByActualSales.',
      );
    }

    return {
      period: window,
      method: settings.method,
      indirectCost: {
        total: indirectTotal,
        byCategory: this.groupByCategory(expanded),
        expenses: expanded.map((item) => ({
          expenseId: item.expense.id,
          description: item.expense.description,
          category: item.expense.category,
          type: item.expense.type,
          recurrence: item.expense.recurrence,
          occurrences: item.occurrences.length,
          total: item.total,
        })),
      },
      divisor: {
        estimatedSalesUnitsPerPeriod: settings.estimatedSalesUnits,
        referencePeriod: settings.referencePeriod,
        referencePeriods: periods,
        estimatedSalesUnits: estimatedUnits,
        actualSalesUnits: actual.units,
        actualRevenue: actual.revenue,
      },
      /** Custo indireto que cada unidade vendida carrega. */
      costPerUnit,
      /** O mesmo cálculo com o volume que de fato saiu — o teste da estimativa. */
      costPerUnitByActualSales,
      settings: {
        includeFixed: settings.includeFixed,
        includeVariable: settings.includeVariable,
      },
      caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Custo completo
  // ---------------------------------------------------------------------------

  /**
   * Custo direto + custo indireto rateado.
   *
   * O custo direto vem da ficha técnica pelo custo atual dos insumos; o
   * indireto é o mesmo valor por unidade para todos os pratos, que é como o
   * PER_SOLD_UNIT funciona — e é também a limitação dele: um refrigerante de
   * R$ 8 absorve o mesmo aluguel que uma pizza de R$ 60. Corrigir isso é o que
   * o BY_REVENUE vai fazer.
   *
   * Nada aqui altera preço de venda.
   */
  async getFullCost(userId: string, filters: ExpensePeriodDto) {
    const allocation = await this.getAllocation(userId, filters);
    const costReport = await this.recipesService.getCostReport(userId);
    const withoutRecipe = await this.recipesService.findProductsWithoutRecipe(
      userId,
    );

    const allocated = allocation.costPerUnit ?? new Prisma.Decimal(0);

    const items = costReport.items.map((item) => {
      const directCost = new Prisma.Decimal(item.directCost);
      const fullCost = directCost.add(allocated).toDecimalPlaces(UNIT_COST_SCALE);
      const sellingPrice =
        item.sellingPrice === null ? null : new Prisma.Decimal(item.sellingPrice);

      return {
        productId: item.productId,
        productName: item.productName,
        recipeId: item.recipeId,
        recipeVersion: item.version,
        directCost: directCost.toDecimalPlaces(UNIT_COST_SCALE),
        allocatedIndirectCost: allocated,
        fullCost,
        sellingPrice,
        // Descrição do preço que já existe, não sugestão de preço novo.
        resultPerUnit:
          sellingPrice === null
            ? null
            : sellingPrice.sub(fullCost).toDecimalPlaces(MONEY_SCALE),
        fullCostPercentOfPrice:
          sellingPrice === null || sellingPrice.isZero()
            ? null
            : fullCost.div(sellingPrice).mul(100).toDecimalPlaces(2),
        hasMissingCost: item.hasMissingCost,
      };
    });

    const belowFullCost = items.filter(
      (item) => item.resultPerUnit !== null && item.resultPerUnit.lt(0),
    );

    return {
      period: allocation.period,
      method: allocation.method,
      allocatedIndirectCostPerUnit: allocation.costPerUnit,
      items: items.sort((a, b) => a.productName.localeCompare(b.productName)),
      summary: {
        products: items.length,
        indirectCostTotal: allocation.indirectCost.total,
        withMissingSupplyCost: items.filter((item) => item.hasMissingCost).length,
        /** Pratos cujo preço atual não cobre o custo completo. */
        belowFullCost: belowFullCost.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          sellingPrice: item.sellingPrice,
          fullCost: item.fullCost,
          resultPerUnit: item.resultPerUnit,
        })),
        /** Sem ficha ativa não há custo direto, e o completo fica desconhecido. */
        productsWithoutRecipe: withoutRecipe.items,
      },
      notes: [
        'O custo indireto é distribuído igualmente por unidade vendida ' +
          '(PER_SOLD_UNIT): todo produto absorve o mesmo valor, independente ' +
          'do preço dele.',
        'Nenhuma despesa foi somada ao preço de venda. Este relatório apenas ' +
          'mede o impacto no custo; a formação de preço é assunto separado.',
      ],
      caveats: allocation.caveats,
    };
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  /**
   * Só PER_SOLD_UNIT está implementado. Os demais recusam explicitamente em vez
   * de devolver um número plausível e errado — mesmo critério do custeio de
   * insumo.
   */
  private divisorFor(
    method: AllocationMethod,
    estimatedUnits: Prisma.Decimal,
  ): Prisma.Decimal {
    switch (method) {
      case AllocationMethod.PER_SOLD_UNIT:
        return estimatedUnits;

      case AllocationMethod.BY_REVENUE:
        throw new NotImplementedException(
          'Allocation by revenue is not enabled yet: it needs the expense ' +
            'share to follow each product price, which changes the per-unit ' +
            'cost into a per-product one. `estimatedRevenue` is already ' +
            'stored, so enabling it is a matter of defining how products ' +
            'without a price take part.',
        );

      case AllocationMethod.MANUAL:
        throw new NotImplementedException(
          'Manual allocation is not implemented yet: it requires a per-product ' +
            'share table, which does not exist yet.',
        );

      default:
        throw new NotImplementedException(
          `Unknown allocation method: ${method}.`,
        );
    }
  }

  /** Unidades e receita que de fato saíram no período de competência. */
  private async actualSales(userId: string, window: DateWindow) {
    const result = await this.prismaService.productOrder.aggregate({
      where: {
        userId,
        order: {
          userId,
          paid: true,
          deletedAt: null,
          status: { not: OrderType.CANCELED },
          // O fim da janela é data pura; sem empurrar para o fim do dia, tudo
          // que foi vendido depois da meia-noite do último dia ficaria de fora.
          paidAt: { gte: window.from, lte: this.endOfDay(window.to) },
        },
      },
      _sum: { quantity: true, totalPrice: true },
    });

    return {
      units: new Prisma.Decimal(result._sum.quantity ?? 0),
      revenue: new Prisma.Decimal(result._sum.totalPrice ?? 0),
    };
  }

  private endOfDay(date: Date) {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  private groupByCategory(
    expanded: Awaited<ReturnType<ExpensesService['expandForPeriod']>>,
  ) {
    const byCategory = new Map<
      string,
      { categoryId: string | null; name: string; total: Prisma.Decimal }
    >();

    for (const { expense, total } of expanded) {
      const key = expense.expenseCategoryId ?? 'SEM_CATEGORIA';
      const current = byCategory.get(key) ?? {
        categoryId: expense.expenseCategoryId,
        name: expense.category?.name ?? 'Sem categoria',
        total: new Prisma.Decimal(0),
      };

      current.total = current.total.add(total);
      byCategory.set(key, current);
    }

    return [...byCategory.values()].sort((a, b) => b.total.comparedTo(a.total));
  }
}
