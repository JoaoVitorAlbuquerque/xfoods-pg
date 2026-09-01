import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { StockMovementsService } from 'src/modules/stock/services/stock-movements.service';

/** Origem das movimentações de venda — granular por item vendido. */
export const ORDER_ITEM_REFERENCE = 'ORDER_ITEM';

export class SaleWithoutRecipeException extends ConflictException {
  constructor(productName: string) {
    super(
      `${productName} has no active recipe, so this sale cannot be completed ` +
        'while allowSaleWithoutRecipe is off. Create a recipe for it, or turn ' +
        'the setting on to sell without automatic stock consumption.',
    );
  }
}

export type SaleStockAlert = {
  type: 'NO_RECIPE' | 'MISSING_COST';
  productOrderId: string;
  productId: string;
  productName: string;
  message: string;
};

/**
 * Ponte entre a venda e o estoque.
 *
 * Tudo aqui recebe o client da transação de quem chamou: a baixa precisa
 * acontecer na mesma transação que confirma o pagamento, senão uma falha no
 * meio deixaria pagamento sem consumo — ou consumo sem pagamento.
 */
@Injectable()
export class OrderStockService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recipesService: RecipesService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  /**
   * Consome os insumos das fichas dos produtos vendidos e congela o custo no
   * item de venda.
   *
   * Idempotente por `Order.stockAppliedAt`: a reserva é um UPDATE condicional,
   * então duas requisições simultâneas para o mesmo pedido só deixam uma
   * passar — a outra enxerga zero linhas afetadas e não baixa nada.
   */
  async applySale(
    userId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
  ) {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, userId, stockAppliedAt: null },
      data: { stockAppliedAt: new Date() },
    });

    if (claimed.count !== 1) {
      return {
        applied: false,
        reason: 'ALREADY_APPLIED' as const,
        movements: 0,
        alerts: [] as SaleStockAlert[],
      };
    }

    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      include: {
        products: {
          include: { product: { select: { id: true, name: true } } },
        },
      },
    });

    const settings = await tx.stockSettings.findUnique({
      where: { userId },
      select: { allowSaleWithoutRecipe: true },
    });

    const allowWithoutRecipe = settings?.allowSaleWithoutRecipe ?? true;

    const alerts: SaleStockAlert[] = [];
    let movements = 0;

    for (const item of order.products) {
      const recipe = await tx.recipe.findFirst({
        where: { userId, productId: item.productId, active: true },
        include: { sizeFactors: true },
      });

      if (!recipe) {
        if (!allowWithoutRecipe) {
          throw new SaleWithoutRecipeException(item.product.name);
        }

        // Vende, avisa e não consome. O estoque deste prato passa a não ser
        // confiável — por isso o alerta volta na resposta, em vez de a venda
        // seguir em silêncio.
        alerts.push({
          type: 'NO_RECIPE',
          productOrderId: item.id,
          productId: item.productId,
          productName: item.product.name,
          message:
            `${item.product.name} has no active recipe: nothing was consumed ` +
            'from stock for this item.',
        });

        continue;
      }

      const sizeFactor = this.recipesService.sizeFactorFor(
        recipe.sizeFactors,
        item.size,
      );

      // Consumo de UMA unidade do prato no tamanho vendido. As sub-receitas
      // já vêm desdobradas em insumos, porque sub-receita não é estocada.
      const perDish = await this.recipesService.explodeToSupplies(
        userId,
        recipe.id,
        sizeFactor,
        tx,
      );

      const unitCost = perDish.reduce(
        (total, line) => total.add(line.totalCost),
        new Prisma.Decimal(0),
      );

      if (perDish.some((line) => line.hasMissingCost)) {
        alerts.push({
          type: 'MISSING_COST',
          productOrderId: item.id,
          productId: item.productId,
          productName: item.product.name,
          message:
            `${item.product.name} has supplies that were never purchased: ` +
            'its recorded cost is understated.',
        });
      }

      for (const line of perDish) {
        await this.stockMovementsService.register(
          userId,
          {
            supplyId: line.supplyId,
            type: StockMovementType.SALE,
            direction: 'OUT',
            quantity: line.quantityBase.mul(item.quantity),
            unitCode: line.baseUnitCode,
            unitCostBase: line.unitCost,
            reason: `Venda mesa ${order.table} · ${item.product.name}`,
            referenceType: ORDER_ITEM_REFERENCE,
            referenceId: item.id,
            occurredAt: order.paidAt ?? new Date(),
            // `forceNegative` NÃO é passado de propósito: a trava de saldo
            // negativo da configuração vale também para a venda. Com
            // `allowNegativeStock` desligado, faltar insumo derruba a
            // transação inteira e o pagamento não é confirmado.
          },
          tx,
        );

        movements += 1;
      }

      // Snapshot: versão da ficha e custo congelados no item vendido. Mudar a
      // ficha ou o preço do insumo depois não altera o que esta venda custou.
      await tx.productOrder.update({
        where: { id: item.id },
        data: {
          recipeId: recipe.id,
          recipeUnitCost: unitCost,
          recipeTotalCost: unitCost.mul(item.quantity),
        },
      });
    }

    return { applied: true, reason: null, movements, alerts };
  }

  /**
   * Devolve ao estoque o que a venda consumiu, com movimentações RETURN.
   *
   * Nenhuma movimentação histórica é apagada nem alterada: o estorno é um
   * lançamento novo, apontando para o consumo que desfaz. O índice único em
   * `reversalOfId` garante que o mesmo consumo não seja devolvido duas vezes.
   */
  async reverseSale(
    userId: string,
    orderId: string,
    reason: string,
    tx: Prisma.TransactionClient,
  ) {
    const released = await tx.order.updateMany({
      where: { id: orderId, userId, stockAppliedAt: { not: null } },
      data: { stockAppliedAt: null },
    });

    if (released.count !== 1) {
      return {
        reversed: false,
        reason: 'NOTHING_TO_REVERSE' as const,
        movements: 0,
      };
    }

    const items = await tx.productOrder.findMany({
      where: { orderId },
      select: { id: true },
    });

    const sales = await tx.stockMovement.findMany({
      where: {
        userId,
        type: StockMovementType.SALE,
        referenceType: ORDER_ITEM_REFERENCE,
        referenceId: { in: items.map((item) => item.id) },
        // Só o que ainda não foi devolvido. Sem este filtro, um pedido baixado,
        // estornado e baixado de novo teria o primeiro consumo devolvido duas
        // vezes.
        reversedBy: { is: null },
      },
      include: { supply: { select: { baseUnit: { select: { code: true } } } } },
    });

    for (const sale of sales) {
      await this.stockMovementsService.register(
        userId,
        {
          supplyId: sale.supplyId,
          type: StockMovementType.RETURN,
          direction: 'IN',
          quantity: new Prisma.Decimal(sale.quantityBase).abs(),
          unitCode: sale.supply.baseUnit.code,
          // Mesmo custo do consumo original: o estorno precisa desfazer
          // exatamente o valor que saiu, não o valor de hoje.
          unitCostBase: sale.unitCost,
          reason,
          referenceType: ORDER_ITEM_REFERENCE,
          referenceId: sale.referenceId,
          reversalOfId: sale.id,
        },
        tx,
      );
    }

    return { reversed: true, reason: null, movements: sales.length };
  }

  /**
   * Consumo registrado de um pedido — o que saiu, o que voltou e o saldo
   * líquido por insumo.
   */
  async getConsumption(userId: string, orderId: string) {
    const items = await this.prismaService.productOrder.findMany({
      where: { orderId, userId },
      select: {
        id: true,
        quantity: true,
        size: true,
        recipeId: true,
        recipeUnitCost: true,
        recipeTotalCost: true,
        product: { select: { id: true, name: true } },
        recipe: { select: { id: true, version: true } },
      },
    });

    const movements = await this.prismaService.stockMovement.findMany({
      where: {
        userId,
        referenceType: ORDER_ITEM_REFERENCE,
        referenceId: { in: items.map((item) => item.id) },
      },
      include: {
        supply: { select: { id: true, name: true } },
        unit: { select: { code: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const netBySupply = new Map<
      string,
      { supplyId: string; supplyName: string; quantityBase: Prisma.Decimal }
    >();

    for (const movement of movements) {
      const current = netBySupply.get(movement.supplyId) ?? {
        supplyId: movement.supplyId,
        supplyName: movement.supply.name,
        quantityBase: new Prisma.Decimal(0),
      };

      current.quantityBase = current.quantityBase.add(movement.quantityBase);
      netBySupply.set(movement.supplyId, current);
    }

    return {
      items,
      movements,
      // Zerado em todos os insumos significa venda totalmente estornada.
      netConsumption: [...netBySupply.values()],
      totalRecipeCost: items.reduce(
        (total, item) => total.add(item.recipeTotalCost ?? 0),
        new Prisma.Decimal(0),
      ),
    };
  }
}
