import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CostSource,
  Prisma,
  ProductionStatus,
  StockMovementType,
} from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { UnitConversionService } from 'src/modules/measurement-units/services/unit-conversion.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { StockMovementsService } from 'src/modules/stock/services/stock-movements.service';
import { SupplyCostingService } from 'src/modules/stock/services/supply-costing.service';
import {
  ConfirmProductionOrderDto,
  CreateProductionOrderDto,
  ListProductionOrdersDto,
  ProductionItemDto,
} from '../dto/production.dto';

/** Origem das movimentações de produção. */
export const PRODUCTION_REFERENCE = 'PRODUCTION_ORDER';

const PRODUCTION_INCLUDE = {
  recipe: {
    select: {
      id: true,
      name: true,
      version: true,
      yieldQuantity: true,
      // `factorToBase` entra porque o rendimento informado é convertido da
      // unidade da ficha para a unidade base do subproduto.
      yieldUnit: {
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          factorToBase: true,
        },
      },
    },
  },
  outputSupply: {
    select: {
      id: true,
      name: true,
      currentStock: true,
      baseUnit: {
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          factorToBase: true,
        },
      },
    },
  },
  items: {
    include: {
      supply: { select: { id: true, name: true } },
      unit: { select: { code: true } },
    },
  },
} satisfies Prisma.ProductionOrderInclude;

const MONEY_SCALE = 4;
const UNIT_COST_SCALE = 6;

/**
 * Ordem de produção: transforma insumos em subproduto estocado.
 *
 * O lote nasce rascunho e não encosta no estoque. Ao confirmar, na MESMA
 * transação, cada ingrediente sai e o subproduto entra — se qualquer etapa
 * falhar, nada acontece. Sem isso existiria o estado em que o tomate saiu e o
 * molho não entrou, e o estoque passaria a mentir nas duas pontas.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recipesService: RecipesService,
    private readonly stockMovementsService: StockMovementsService,
    private readonly supplyCostingService: SupplyCostingService,
    private readonly unitConversionService: UnitConversionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  findAllByUserId(userId: string, filters: ListProductionOrdersDto) {
    return this.prismaService.productionOrder.findMany({
      where: {
        userId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.recipeId ? { recipeId: filters.recipeId } : {}),
        ...(filters.outputSupplyId
          ? { outputSupplyId: filters.outputSupplyId }
          : {}),
        ...(filters.from || filters.to
          ? {
              producedAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: PRODUCTION_INCLUDE,
      orderBy: [{ producedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(userId: string, productionOrderId: string) {
    const order = await this.prismaService.productionOrder.findFirst({
      where: { id: productionOrderId, userId },
      include: PRODUCTION_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Production order not found.');
    }

    return order;
  }

  /**
   * Rendimento previsto contra o real, lote a lote.
   *
   * É o relatório que transforma "o molho rende 10 kg" numa medição: se todo
   * lote sai com 9, a ficha está errada, não a cozinha.
   */
  async getYieldReport(userId: string, filters: ListProductionOrdersDto) {
    const orders = await this.findAllByUserId(userId, {
      ...filters,
      status: ProductionStatus.CONFIRMED,
    });

    const items = orders.map((order) => ({
      productionOrderId: order.id,
      producedAt: order.producedAt,
      recipeId: order.recipeId,
      recipeName: order.recipe.name,
      recipeVersion: order.recipe.version,
      outputSupplyId: order.outputSupplyId,
      outputSupplyName: order.outputSupply.name,
      baseUnit: order.outputSupply.baseUnit.code,
      batches: order.batches,
      expectedQuantity: order.expectedQuantity,
      actualQuantity: order.actualQuantity,
      yieldDifference: order.yieldDifference,
      yieldPercent: order.yieldPercent,
      totalCost: order.totalCost,
      unitCost: order.unitCost,
    }));

    const expected = items.reduce(
      (total, item) => total.add(item.expectedQuantity),
      new Prisma.Decimal(0),
    );
    const actual = items.reduce(
      (total, item) => total.add(item.actualQuantity),
      new Prisma.Decimal(0),
    );

    const below = items.filter((item) => item.yieldDifference.lt(0));

    return {
      items,
      summary: {
        batches: items.length,
        // Quantidade só soma quando os lotes são do mesmo insumo; com insumos
        // diferentes o total é a soma de grandezas distintas. Por isso o
        // resumo agregado só é confiável com o filtro de insumo aplicado.
        expectedQuantity: expected,
        actualQuantity: actual,
        difference: actual.sub(expected),
        yieldPercent: expected.isZero()
          ? null
          : actual.div(expected).mul(100).toDecimalPlaces(4),
        batchesBelowExpected: below.length,
        /** Custo dos ingredientes que não viraram produto. */
        lostValue: below
          .reduce(
            (total, item) =>
              total.add(item.yieldDifference.abs().mul(item.unitCost)),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(MONEY_SCALE),
        singleSupply: new Set(items.map((item) => item.outputSupplyId)).size <= 1,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Escrita
  // ---------------------------------------------------------------------------

  async create(userId: string, dto: CreateProductionOrderDto) {
    const recipe = await this.loadProducibleRecipe(userId, dto.recipeId);
    const batches = new Prisma.Decimal(dto.batches ?? 1);

    if (batches.lte(0)) {
      throw new BadRequestException('batches must be greater than zero.');
    }

    // Rendimento previsto, já na unidade base do insumo de saída: 10 KG de
    // molho num insumo com base em grama são 10.000 de saldo.
    const expectedQuantity = this.unitConversionService.convert(
      new Prisma.Decimal(recipe.yieldQuantity).mul(batches),
      recipe.yieldUnit,
      recipe.outputSupply.baseUnit,
    );

    const items = dto.items
      ? await this.buildItemsFromDto(userId, dto.items)
      : await this.buildItemsFromRecipe(userId, recipe.id, batches);

    if (items.length === 0) {
      throw new BadRequestException(
        'A production order needs at least one ingredient.',
      );
    }

    const totalCost = items.reduce(
      (total, item) => total.add(item.totalCost),
      new Prisma.Decimal(0),
    );

    return this.prismaService.productionOrder.create({
      data: {
        userId,
        recipeId: recipe.id,
        outputSupplyId: recipe.outputSupply.id,
        batches,
        expectedQuantity,
        // Rascunho assume o previsto. O número verdadeiro chega na confirmação,
        // quando alguém pesou o que saiu.
        actualQuantity: expectedQuantity,
        yieldDifference: new Prisma.Decimal(0),
        yieldPercent: new Prisma.Decimal(100),
        totalCost: totalCost.toDecimalPlaces(MONEY_SCALE),
        unitCost: expectedQuantity.isZero()
          ? new Prisma.Decimal(0)
          : totalCost.div(expectedQuantity).toDecimalPlaces(UNIT_COST_SCALE),
        notes: dto.notes?.trim(),
        producedAt: dto.producedAt ? new Date(dto.producedAt) : new Date(),
        items: { create: items },
      },
      include: PRODUCTION_INCLUDE,
    });
  }

  /**
   * Consome ingredientes e produz o subproduto, numa transação só.
   *
   * O custo do lote não é recalculado por fora: cada saída já é valorizada pelo
   * razão com o custo vigente do insumo, e a soma dessas saídas é o custo da
   * produção. Calcular à parte abriria espaço para o lote e o estoque
   * discordarem sobre quanto o tomate custou naquele instante.
   */
  async confirm(
    userId: string,
    productionOrderId: string,
    dto: ConfirmProductionOrderDto = {},
  ) {
    const order = await this.findOne(userId, productionOrderId);

    if (order.status !== ProductionStatus.DRAFT) {
      throw new ConflictException(
        `Production order is ${order.status} and can no longer be confirmed.`,
      );
    }

    const actualQuantity = await this.resolveActualQuantity(userId, order, dto);

    if (actualQuantity.lte(0)) {
      throw new BadRequestException(
        'The actual yield must be greater than zero. A batch that produced ' +
          'nothing is a loss of the ingredients, not a production — register ' +
          'it as a stock loss.',
      );
    }

    return this.prismaService.$transaction(async (tx) => {
      // Trava de idempotência: se outra requisição confirmou entre a leitura
      // acima e este ponto, nenhuma linha é afetada e nada é lançado.
      const claimed = await tx.productionOrder.updateMany({
        where: {
          id: productionOrderId,
          userId,
          status: ProductionStatus.DRAFT,
        },
        data: { status: ProductionStatus.CONFIRMED, confirmedAt: new Date() },
      });

      if (claimed.count !== 1) {
        throw new ConflictException(
          'Production order was already confirmed by another request.',
        );
      }

      let totalCost = new Prisma.Decimal(0);

      for (const item of order.items) {
        const movement = await this.stockMovementsService.register(
          userId,
          {
            supplyId: item.supplyId,
            type: StockMovementType.PRODUCTION,
            direction: 'OUT',
            // `quantityBase` está na unidade base DO INGREDIENTE, e cada um tem
            // a sua. Omitir a unidade faz o motor usar a base do próprio
            // insumo; informar a do subproduto converteria grama em quilo.
            quantity: item.quantityBase,
            reason: `Produção · ${order.recipe.name ?? 'sub-receita'}`,
            referenceType: PRODUCTION_REFERENCE,
            referenceId: order.id,
            occurredAt: order.producedAt,
            // `forceNegative` NÃO é passado: produzir com insumo faltando é
            // exatamente o caso em que a trava de saldo negativo deve valer.
          },
          tx,
        );

        // O razão gravou a saída com sinal negativo; o custo do lote é o valor
        // absoluto do que saiu.
        const itemCost = new Prisma.Decimal(movement.totalCost).abs();
        totalCost = totalCost.add(itemCost);

        await tx.productionOrderItem.update({
          where: { id: item.id },
          data: {
            movementId: movement.id,
            unitCost: new Prisma.Decimal(movement.unitCost),
            totalCost: itemCost.toDecimalPlaces(MONEY_SCALE),
          },
        });
      }

      const unitCost = totalCost
        .div(actualQuantity)
        .toDecimalPlaces(UNIT_COST_SCALE);

      const outputMovement = await this.stockMovementsService.register(
        userId,
        {
          supplyId: order.outputSupplyId,
          type: StockMovementType.PRODUCTION,
          direction: 'IN',
          // Já convertido para a unidade base do subproduto em `resolveActualQuantity`.
          quantity: actualQuantity,
          unitCostBase: unitCost,
          reason: `Produção · ${order.recipe.name ?? 'sub-receita'}`,
          referenceType: PRODUCTION_REFERENCE,
          referenceId: order.id,
          occurredAt: order.producedAt,
        },
        tx,
      );

      await this.recordCostHistory(tx, userId, order, unitCost);

      const expected = new Prisma.Decimal(order.expectedQuantity);

      await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          actualQuantity,
          yieldDifference: actualQuantity.sub(expected),
          yieldPercent: expected.isZero()
            ? null
            : actualQuantity.div(expected).mul(100).toDecimalPlaces(4),
          totalCost: totalCost.toDecimalPlaces(MONEY_SCALE),
          unitCost,
          outputMovementId: outputMovement.id,
          ...(dto.notes === undefined ? {} : { notes: dto.notes?.trim() }),
        },
      });

      return tx.productionOrder.findUnique({
        where: { id: order.id },
        include: PRODUCTION_INCLUDE,
      });
    });
  }

  /**
   * Só rascunho pode ser cancelado — mesma regra da compra.
   *
   * Cancelar um lote confirmado exigiria devolver os ingredientes e retirar o
   * subproduto, e o subproduto já pode ter virado prato vendido. É um estorno,
   * e ele não existe: as movimentações do lote são históricas e ficam.
   */
  async cancel(userId: string, productionOrderId: string) {
    const order = await this.findOne(userId, productionOrderId);

    if (order.status !== ProductionStatus.DRAFT) {
      throw new ConflictException(
        `Production order is ${order.status} and can no longer be canceled. ` +
          'Its stock movements are history and are never deleted; to correct ' +
          'the balance, register an adjustment or a loss.',
      );
    }

    return this.prismaService.productionOrder.update({
      where: { id: productionOrderId },
      data: { status: ProductionStatus.CANCELED, canceledAt: new Date() },
      include: PRODUCTION_INCLUDE,
    });
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  private async loadProducibleRecipe(userId: string, recipeId: string) {
    const recipe = await this.prismaService.recipe.findFirst({
      where: { id: recipeId, userId },
      include: {
        yieldUnit: true,
        outputSupply: { include: { baseUnit: true } },
      },
    });

    if (!recipe) {
      throw new NotFoundException('Recipe not found.');
    }

    if (!recipe.outputSupply) {
      throw new BadRequestException(
        'This recipe has no output supply, so it cannot be produced. Set ' +
          'outputSupplyId on the sub-recipe to give it a stock balance of its ' +
          'own — without it, the sub-recipe only composes cost and is consumed ' +
          'by exploding into its ingredients at sale time.',
      );
    }

    if (!recipe.yieldUnit) {
      throw new BadRequestException(
        'This recipe has no yield unit, so there is no way to know how much ' +
          'one batch adds to stock.',
      );
    }

    return recipe;
  }

  /**
   * Ingredientes derivados da própria ficha.
   *
   * Reaproveita o desdobramento da ficha técnica, então uma sub-receita que usa
   * outra sub-receita se resolve sozinha: a aninhada estocada é consumida como
   * insumo, e a não estocada desce até os insumos dela.
   */
  private async buildItemsFromRecipe(
    userId: string,
    recipeId: string,
    batches: Prisma.Decimal,
  ) {
    const exploded = await this.recipesService.explodeToSupplies(
      userId,
      recipeId,
      batches,
    );

    const supplies = await this.loadSupplies(
      userId,
      exploded.map((line) => line.supplyId),
    );

    return exploded.map((line) => {
      const supply = supplies.get(line.supplyId);

      return {
        supplyId: line.supplyId,
        unitId: supply.baseUnitId,
        quantity: line.quantityBase,
        quantityBase: line.quantityBase,
        unitCost: line.unitCost,
        totalCost: line.totalCost.toDecimalPlaces(MONEY_SCALE),
      };
    });
  }

  /** Ingredientes informados à mão, com a quantidade que de fato foi usada. */
  private async buildItemsFromDto(userId: string, items: ProductionItemDto[]) {
    const built = [];

    for (const item of items) {
      const supply = await this.prismaService.supply.findFirst({
        where: { id: item.supplyId, userId },
        include: { baseUnit: true },
      });

      if (!supply) {
        throw new NotFoundException(`Supply ${item.supplyId} not found.`);
      }

      const unit = item.unit
        ? await this.resolveUnit(userId, item.unit)
        : supply.baseUnit;

      if (unit.kind !== supply.baseUnit.kind) {
        throw new BadRequestException(
          `Cannot use ${unit.code} (${unit.kind}) for ${supply.name}, whose ` +
            `base unit is ${supply.baseUnit.code} (${supply.baseUnit.kind}).`,
        );
      }

      const quantity = new Prisma.Decimal(item.quantity);
      const quantityBase = this.unitConversionService.convert(
        quantity,
        unit,
        supply.baseUnit,
      );
      const unitCost = this.supplyCostingService.getCurrentUnitCost(supply);

      built.push({
        supplyId: supply.id,
        unitId: unit.id,
        quantity,
        quantityBase,
        unitCost,
        totalCost: quantityBase.mul(unitCost).toDecimalPlaces(MONEY_SCALE),
      });
    }

    return built;
  }

  /** Rendimento real informado, convertido para a unidade base do subproduto. */
  private async resolveActualQuantity(
    userId: string,
    order: Prisma.ProductionOrderGetPayload<{
      include: typeof PRODUCTION_INCLUDE;
    }>,
    dto: ConfirmProductionOrderDto,
  ): Promise<Prisma.Decimal> {
    if (dto.actualQuantity === undefined) {
      return new Prisma.Decimal(order.expectedQuantity);
    }

    const informed = new Prisma.Decimal(dto.actualQuantity);

    const unit = dto.actualQuantityUnit
      ? await this.resolveUnit(userId, dto.actualQuantityUnit)
      : order.recipe.yieldUnit;

    if (unit.kind !== order.outputSupply.baseUnit.kind) {
      throw new BadRequestException(
        `Cannot report a yield in ${unit.code} (${unit.kind}) for ` +
          `${order.outputSupply.name}, whose base unit is ` +
          `${order.outputSupply.baseUnit.code} ` +
          `(${order.outputSupply.baseUnit.kind}).`,
      );
    }

    return this.unitConversionService.convert(
      informed,
      unit,
      order.outputSupply.baseUnit,
    );
  }

  /**
   * O custo do subproduto entra no histórico como qualquer outro custo.
   *
   * Sem isso, o relatório de variação mostraria o molho parado no primeiro
   * lote, e uma alta no tomate nunca apareceria como alta no molho.
   */
  private async recordCostHistory(
    tx: Prisma.TransactionClient,
    userId: string,
    order: Prisma.ProductionOrderGetPayload<{
      include: typeof PRODUCTION_INCLUDE;
    }>,
    unitCost: Prisma.Decimal,
  ) {
    const previous = await tx.supplyCostHistory.findFirst({
      where: { userId, supplyId: order.outputSupplyId },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
      select: { unitCostBase: true },
    });

    const previousUnitCostBase = previous
      ? new Prisma.Decimal(previous.unitCostBase)
      : null;

    await tx.supplyCostHistory.create({
      data: {
        userId,
        supplyId: order.outputSupplyId,
        unitCostBase: unitCost,
        previousUnitCostBase,
        variationPercent:
          previousUnitCostBase === null || previousUnitCostBase.isZero()
            ? null
            : unitCost
                .sub(previousUnitCostBase)
                .div(previousUnitCostBase)
                .mul(100)
                .toDecimalPlaces(4),
        unitPrice: unitCost,
        unitId: order.outputSupply.baseUnit.id,
        source: CostSource.PRODUCTION,
        effectiveAt: order.producedAt,
      },
    });
  }

  private async loadSupplies(userId: string, supplyIds: string[]) {
    const supplies = await this.prismaService.supply.findMany({
      where: { userId, id: { in: supplyIds } },
      select: { id: true, baseUnitId: true },
    });

    return new Map(supplies.map((supply) => [supply.id, supply]));
  }

  private async resolveUnit(userId: string, code: string) {
    const normalized = code.trim().toUpperCase();

    const unit = await this.prismaService.measurementUnit.findFirst({
      where: {
        code: normalized,
        active: true,
        OR: [{ userId: null }, { userId }],
      },
    });

    if (!unit) {
      throw new NotFoundException(`Measurement unit ${normalized} not found.`);
    }

    return unit;
  }
}
