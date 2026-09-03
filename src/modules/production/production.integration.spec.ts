import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductionStatus, StockMovementType } from '@prisma/client';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { AuthModule } from 'src/modules/auth/auth.module';
import { MeasurementUnitsModule } from 'src/modules/measurement-units/measurement-units.module';
import { StockModule } from 'src/modules/stock/stock.module';
import { SuppliesModule } from 'src/modules/supplies/supplies.module';
import { PurchasesModule } from 'src/modules/purchases/purchases.module';
import { RecipesModule } from 'src/modules/recipes/recipes.module';
import { OrdersModule } from 'src/modules/orders/orders.module';
import { SuppliesService } from 'src/modules/supplies/services/supplies.service';
import { PurchasesService } from 'src/modules/purchases/services/purchases.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { OrdersService } from 'src/modules/orders/orders.service';
import { StockSettingsService } from 'src/modules/stock/services/stock-settings.service';
import { InsufficientStockException } from 'src/modules/stock/services/stock-movements.service';
import { ProductionModule } from './production.module';
import {
  PRODUCTION_REFERENCE,
  ProductionService,
} from './services/production.service';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 *
 * O cenário é o do enunciado, com custos redondos:
 *
 *   Tomate   8.000 g × R$ 0,005/g = R$ 40,00
 *   Cebola   1.000 g × R$ 0,006/g = R$  6,00
 *   Alho       200 g × R$ 0,040/g = R$  8,00
 *   Temperos   100 g × R$ 0,060/g = R$  6,00
 *   -------------------------------------------
 *   Custo do lote                  = R$ 60,00
 *   Rendimento                     = 10 kg
 *   Custo por kg                   = R$  6,00   (R$ 0,006/g)
 */
describe('Sub-receitas e produção (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let production: ProductionService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let recipes: RecipesService;
  let orders: OrdersService;
  let stockSettings: StockSettingsService;

  let userId: string;
  let menuCategoryId: string;

  const TEST_EMAIL = 'production-integration@xfoods.test';

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

    await prisma.productionOrderItem.deleteMany({
      where: { productionOrder: { userId: user.id } },
    });
    await prisma.productionOrder.deleteMany({ where: { userId: user.id } });
    await prisma.stockMovement.updateMany({
      where: { userId: user.id },
      data: { reversalOfId: null },
    });
    await prisma.productOrder.updateMany({
      where: { userId: user.id },
      data: { recipeId: null },
    });
    await prisma.recipeSizeFactor.deleteMany({
      where: { recipe: { userId: user.id } },
    });
    await prisma.recipeItem.deleteMany({
      where: { recipe: { userId: user.id } },
    });
    await prisma.recipe.deleteMany({ where: { userId: user.id } });
    await prisma.supplyCostHistory.deleteMany({ where: { userId: user.id } });
    await prisma.purchaseItem.deleteMany({
      where: { purchase: { userId: user.id } },
    });
    await prisma.purchase.deleteMany({ where: { userId: user.id } });
    await prisma.supply.updateMany({
      where: { userId: user.id },
      data: { lastSupplierId: null, lastPurchaseUnitId: null },
    });
    await prisma.stockMovement.deleteMany({ where: { userId: user.id } });
    await prisma.supply.deleteMany({ where: { userId: user.id } });
    await prisma.supplyCategory.deleteMany({ where: { userId: user.id } });
    await prisma.supplier.deleteMany({ where: { userId: user.id } });
    await prisma.productOrder.deleteMany({ where: { userId: user.id } });
    await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.product.deleteMany({ where: { userId: user.id } });
    await prisma.category.deleteMany({ where: { userId: user.id } });
    await prisma.stockSettings.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        AuthModule,
        MeasurementUnitsModule,
        StockModule,
        SuppliesModule,
        PurchasesModule,
        RecipesModule,
        OrdersModule,
        ProductionModule,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    production = moduleRef.get(ProductionService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    recipes = moduleRef.get(RecipesService);
    orders = moduleRef.get(OrdersService);
    stockSettings = moduleRef.get(StockSettingsService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Produção',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;

    const category = await prisma.category.create({
      data: { userId, name: 'Pizzas', icon: '🍕' },
    });
    menuCategoryId = category.id;

    await stockSettings.update(userId, {
      allowNegativeStock: false,
      allowSaleWithoutRecipe: true,
    });
  }, 30000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  // ---------------------------------------------------------------------------

  let seq = 0;
  const next = () => (seq += 1);

  /** Insumo abastecido por compra, com custo por unidade base conhecido. */
  const insumo = async (
    name: string,
    baseUnit: string,
    quantity: string,
    unit: string,
    totalPrice: string,
  ) => {
    const supply = await supplies.create(userId, {
      name: `${name} ${next()}`,
      baseUnit,
    });

    const compra = await purchases.create(userId, {
      items: [{ supplyId: supply.id, unit, quantity, totalPrice }],
    });
    await purchases.confirm(userId, compra.id);

    return supply;
  };

  /** Insumo sem compra: nasce zerado, para receber só produção. */
  const insumoVazio = (name: string, baseUnit: string) =>
    supplies.create(userId, { name: `${name} ${next()}`, baseUnit });

  const saldo = async (supplyId: string) => {
    const supply = await prisma.supply.findUnique({ where: { id: supplyId } });
    return new Prisma.Decimal(supply.currentStock);
  };

  const custoAtual = async (supplyId: string) => {
    const supply = await prisma.supply.findUnique({ where: { id: supplyId } });
    return new Prisma.Decimal(supply.lastCost ?? 0);
  };

  const novoProduto = (name: string, price = '50') =>
    prisma.product.create({
      data: {
        userId,
        categoryId: menuCategoryId,
        name: `${name} ${next()}`,
        description: name,
        imagePath: 'x.png',
        price: new Prisma.Decimal(price),
      },
    });

  /** Monta o molho do enunciado: quatro insumos, ficha e insumo de saída. */
  const montarMolho = async (nome = 'Molho de tomate') => {
    const tomate = await insumo('Tomate', 'G', '20', 'KG', '100'); // 0,005/g
    const cebola = await insumo('Cebola', 'G', '10', 'KG', '60'); // 0,006/g
    const alho = await insumo('Alho', 'G', '2', 'KG', '80'); // 0,040/g
    const temperos = await insumo('Temperos', 'G', '1', 'KG', '60'); // 0,060/g

    const molhoSupply = await insumoVazio(nome, 'G');

    const ficha = await recipes.create(userId, {
      name: `${nome} ${next()}`,
      yieldQuantity: '10',
      yieldUnit: 'KG',
      outputSupplyId: molhoSupply.id,
      items: [
        { supplyId: tomate.id, quantity: '8', unit: 'KG' },
        { supplyId: cebola.id, quantity: '1', unit: 'KG' },
        { supplyId: alho.id, quantity: '200', unit: 'G' },
        { supplyId: temperos.id, quantity: '100', unit: 'G' },
      ],
    });

    return { tomate, cebola, alho, temperos, molhoSupply, ficha };
  };

  // ---------------------------------------------------------------------------

  describe('sub-receita produzida', () => {
    it('aceita insumo de saída e guarda o vínculo', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      expect(ficha.outputSupplyId).toBe(molhoSupply.id);
      expect(ficha.outputSupply.name).toBe(molhoSupply.name);
      expect(ficha.yieldQuantity.toString()).toBe('10');
    });

    it('calcula o custo do lote pela ficha', async () => {
      const { ficha } = await montarMolho();
      const comCusto = await recipes.findOne(userId, ficha.id);

      // 40 + 6 + 8 + 6
      expect(comCusto.directCost.toString()).toBe('60');
      // Custo por unidade de rendimento: R$ 60 / 10 kg
      expect(comCusto.costPerYieldUnit.toString()).toBe('6');
    });

    it('recusa insumo de saída num prato', async () => {
      const produto = await novoProduto('Pizza');
      const supply = await insumoVazio('Saída inválida', 'G');

      await expect(
        recipes.create(userId, {
          productId: produto.id,
          outputSupplyId: supply.id,
          items: [{ supplyId: supply.id, quantity: '1', unit: 'G' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * Não existe conversão entre volume e massa sem densidade. Deixar passar
     * transformaria 10 litros de molho em 10 gramas de saldo.
     */
    it('recusa rendimento em grandeza diferente da base do insumo', async () => {
      const tomate = await insumo('Tomate', 'G', '10', 'KG', '50');
      const emGramas = await insumoVazio('Molho grama', 'G');

      await expect(
        recipes.create(userId, {
          name: `Molho volume ${next()}`,
          yieldQuantity: '10',
          yieldUnit: 'L',
          outputSupplyId: emGramas.id,
          items: [{ supplyId: tomate.id, quantity: '1', unit: 'KG' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('a versão nova produz o mesmo subproduto', async () => {
      const { molhoSupply, ficha, tomate } = await montarMolho();

      const v2 = await recipes.newVersion(userId, ficha.id, {
        items: [{ supplyId: tomate.id, quantity: '9', unit: 'KG' }],
      });

      expect(v2.outputSupplyId).toBe(molhoSupply.id);
    });
  });

  // ---------------------------------------------------------------------------

  describe('produção — o exemplo do enunciado', () => {
    it('consome os ingredientes e adiciona o subproduto', async () => {
      const { tomate, cebola, alho, temperos, molhoSupply, ficha } =
        await montarMolho();

      const antes = {
        tomate: await saldo(tomate.id),
        cebola: await saldo(cebola.id),
        alho: await saldo(alho.id),
        temperos: await saldo(temperos.id),
        molho: await saldo(molhoSupply.id),
      };

      const lote = await production.create(userId, { recipeId: ficha.id });
      expect(lote.status).toBe(ProductionStatus.DRAFT);

      // Rascunho não encosta no estoque.
      expect((await saldo(tomate.id)).toString()).toBe(antes.tomate.toString());
      expect((await saldo(molhoSupply.id)).toString()).toBe('0');

      await production.confirm(userId, lote.id);

      expect((await saldo(tomate.id)).toString()).toBe(
        antes.tomate.sub(8000).toString(),
      );
      expect((await saldo(cebola.id)).toString()).toBe(
        antes.cebola.sub(1000).toString(),
      );
      expect((await saldo(alho.id)).toString()).toBe(
        antes.alho.sub(200).toString(),
      );
      expect((await saldo(temperos.id)).toString()).toBe(
        antes.temperos.sub(100).toString(),
      );
      // 10 kg de molho, guardados em grama.
      expect((await saldo(molhoSupply.id)).toString()).toBe('10000');
    }, 30000);

    it('custa R$ 60 no lote e R$ 6,00 por kg', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      const confirmado = await production.confirm(userId, lote.id);

      expect(confirmado.totalCost.toString()).toBe('60');
      // R$ 60 / 10.000 g = R$ 0,006/g, que é R$ 6,00/kg.
      expect(confirmado.unitCost.toString()).toBe('0.006');
      expect((await custoAtual(molhoSupply.id)).toString()).toBe('0.006');
    }, 30000);

    it('registra movimentações PRODUCTION nos dois sentidos', async () => {
      const { ficha, molhoSupply } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, lote.id);

      const movimentos = await prisma.stockMovement.findMany({
        where: {
          userId,
          referenceType: PRODUCTION_REFERENCE,
          referenceId: lote.id,
        },
      });

      expect(movimentos).toHaveLength(5); // 4 saídas + 1 entrada
      expect(
        movimentos.every((m) => m.type === StockMovementType.PRODUCTION),
      ).toBe(true);

      const saidas = movimentos.filter((m) => m.quantityBase.lt(0));
      const entradas = movimentos.filter((m) => m.quantityBase.gt(0));

      expect(saidas).toHaveLength(4);
      expect(entradas).toHaveLength(1);
      expect(entradas[0].supplyId).toBe(molhoSupply.id);
      expect(entradas[0].quantityBase.toString()).toBe('10000');
    }, 30000);

    it('amarra cada movimentação ao seu item do lote', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      const confirmado = await production.confirm(userId, lote.id);

      expect(confirmado.outputMovementId).not.toBeNull();
      expect(confirmado.items.every((item) => item.movementId !== null)).toBe(
        true,
      );

      const soma = confirmado.items.reduce(
        (total, item) => total.add(item.totalCost),
        new Prisma.Decimal(0),
      );
      expect(soma.toString()).toBe(confirmado.totalCost.toString());
    }, 30000);

    it('dobra ingredientes e rendimento com dois lotes', async () => {
      const { tomate, molhoSupply, ficha } = await montarMolho();

      const antes = await saldo(tomate.id);
      const lote = await production.create(userId, {
        recipeId: ficha.id,
        batches: '2',
      });
      const confirmado = await production.confirm(userId, lote.id);

      expect((await saldo(tomate.id)).toString()).toBe(
        antes.sub(16000).toString(),
      );
      expect((await saldo(molhoSupply.id)).toString()).toBe('20000');
      expect(confirmado.totalCost.toString()).toBe('120');
      // O custo por unidade não muda: dobrou tudo.
      expect(confirmado.unitCost.toString()).toBe('0.006');
    }, 30000);

    it('aceita as quantidades que de fato foram usadas', async () => {
      const { tomate, cebola, ficha } = await montarMolho();

      const antes = await saldo(tomate.id);
      const lote = await production.create(userId, {
        recipeId: ficha.id,
        items: [
          { supplyId: tomate.id, quantity: '8.5', unit: 'KG' },
          { supplyId: cebola.id, quantity: '1', unit: 'KG' },
        ],
      });
      await production.confirm(userId, lote.id);

      expect((await saldo(tomate.id)).toString()).toBe(
        antes.sub(8500).toString(),
      );
    }, 30000);
  });

  // ---------------------------------------------------------------------------

  describe('rendimento real', () => {
    it('registra previsto, real e diferença', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      const confirmado = await production.confirm(userId, lote.id, {
        actualQuantity: '9',
      });

      expect(confirmado.expectedQuantity.toString()).toBe('10000');
      expect(confirmado.actualQuantity.toString()).toBe('9000');
      expect(confirmado.yieldDifference.toString()).toBe('-1000');
      expect(confirmado.yieldPercent.toString()).toBe('90');

      // O que entra no estoque é o real, não o previsto.
      expect((await saldo(molhoSupply.id)).toString()).toBe('9000');
    }, 30000);

    /**
     * O ponto de medir rendimento: o mesmo custo em menos produto encarece a
     * unidade. Sem isso, a perda de produção sumiria do custo do prato.
     */
    it('um lote que rendeu menos encarece o subproduto', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      const confirmado = await production.confirm(userId, lote.id, {
        actualQuantity: '8',
      });

      expect(confirmado.totalCost.toString()).toBe('60');
      // R$ 60 / 8.000 g = R$ 0,0075/g, contra os R$ 0,006 previstos.
      expect(confirmado.unitCost.toString()).toBe('0.0075');
      expect((await custoAtual(molhoSupply.id)).toString()).toBe('0.0075');
    }, 30000);

    it('rendimento acima do previsto barateia', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      const confirmado = await production.confirm(userId, lote.id, {
        actualQuantity: '12',
      });

      expect(confirmado.yieldDifference.toString()).toBe('2000');
      expect(confirmado.unitCost.toString()).toBe('0.005');
    }, 30000);

    it('aceita o rendimento em outra unidade da mesma grandeza', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      const confirmado = await production.confirm(userId, lote.id, {
        actualQuantity: '9500',
        actualQuantityUnit: 'G',
      });

      expect(confirmado.actualQuantity.toString()).toBe('9500');
    }, 30000);

    it('recusa rendimento em grandeza incompatível', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });

      await expect(
        production.confirm(userId, lote.id, {
          actualQuantity: '10',
          actualQuantityUnit: 'L',
        }),
      ).rejects.toThrow(BadRequestException);
    }, 30000);

    it('recusa rendimento zero', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });

      await expect(
        production.confirm(userId, lote.id, { actualQuantity: '0' }),
      ).rejects.toBeTruthy();
    }, 30000);

    it('o relatório confronta previsto e real', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      const bom = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, bom.id);

      const ruim = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, ruim.id, { actualQuantity: '9' });

      const relatorio = await production.getYieldReport(userId, {
        outputSupplyId: molhoSupply.id,
      });

      expect(relatorio.summary.batches).toBe(2);
      expect(relatorio.summary.expectedQuantity.toString()).toBe('20000');
      expect(relatorio.summary.actualQuantity.toString()).toBe('19000');
      expect(relatorio.summary.difference.toString()).toBe('-1000');
      expect(relatorio.summary.batchesBelowExpected).toBe(1);
      expect(relatorio.summary.singleSupply).toBe(true);
      // 1.000 g perdidos a R$ 0,00666.../g
      expect(Number(relatorio.summary.lostValue)).toBeCloseTo(6.67, 1);
    }, 30000);
  });

  // ---------------------------------------------------------------------------

  describe('integração com a ficha do prato', () => {
    /**
     * O ponto da fase: a pizza usa molho, não tomate. Continuar desdobrando
     * baixaria o tomate uma segunda vez — ele já saiu quando o lote foi feito.
     */
    it('a venda consome o subproduto, não os ingredientes dele', async () => {
      const { tomate, molhoSupply, ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, lote.id);

      const produto = await novoProduto('Pizza Margherita');
      await recipes.create(userId, {
        productId: produto.id,
        items: [{ subRecipeId: ficha.id, quantity: '150', unit: 'G' }],
      });

      const tomateAntes = await saldo(tomate.id);
      const molhoAntes = await saldo(molhoSupply.id);

      const pedido = await orders.create(userId, {
        table: 3,
        description: null,
        leadId: undefined,
        status: undefined,
        paid: undefined,
        orderIds: undefined,
        products: [{ productId: produto.id, quantity: 2, size: 'MEAN' }],
      } as never);

      await orders.updateOrderPaid(userId, {
        orderIds: [pedido.id],
        paid: true,
        table: 3,
      } as never);

      // 2 pizzas × 150 g = 300 g de molho.
      expect((await saldo(molhoSupply.id)).toString()).toBe(
        molhoAntes.sub(300).toString(),
      );
      // E o tomate não se move: já foi consumido na produção.
      expect((await saldo(tomate.id)).toString()).toBe(tomateAntes.toString());
    }, 30000);

    it('a pizza pode referenciar o molho como insumo comum', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, lote.id);

      const produto = await novoProduto('Pizza Direta');
      const fichaPizza = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: molhoSupply.id, quantity: '150', unit: 'G' }],
      });

      const comCusto = await recipes.findOne(userId, fichaPizza.id);

      // 150 g × R$ 0,006 = R$ 0,90
      expect(comCusto.directCost.toString()).toBe('0.9');
    }, 30000);

    it('a ficha do prato custa o molho pelo custo de produção', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, lote.id);

      const produto = await novoProduto('Pizza Custo');
      const fichaPizza = await recipes.create(userId, {
        productId: produto.id,
        items: [{ subRecipeId: ficha.id, quantity: '150', unit: 'G' }],
      });

      const comCusto = await recipes.findOne(userId, fichaPizza.id);

      expect(comCusto.directCost.toString()).toBe('0.9');
      expect(comCusto.items[0].type).toBe('SUB_RECIPE_STOCKED');
    }, 30000);

    /**
     * Compatibilidade: sub-receita sem insumo de saída continua desdobrando
     * como antes da fase. Fichas antigas não mudam de comportamento.
     */
    it('sub-receita sem insumo de saída continua desdobrando até os insumos', async () => {
      const tomate = await insumo('Tomate solto', 'G', '20', 'KG', '100');

      const molhoSemEstoque = await recipes.create(userId, {
        name: `Molho sem estoque ${next()}`,
        yieldQuantity: '10',
        yieldUnit: 'KG',
        items: [{ supplyId: tomate.id, quantity: '8', unit: 'KG' }],
      });

      const produto = await novoProduto('Pizza Explodida');
      await recipes.create(userId, {
        productId: produto.id,
        items: [{ subRecipeId: molhoSemEstoque.id, quantity: '1', unit: 'KG' }],
      });

      const antes = await saldo(tomate.id);

      const pedido = await orders.create(userId, {
        table: 4,
        description: null,
        leadId: undefined,
        status: undefined,
        paid: undefined,
        orderIds: undefined,
        products: [{ productId: produto.id, quantity: 1, size: 'MEAN' }],
      } as never);

      await orders.updateOrderPaid(userId, {
        orderIds: [pedido.id],
        paid: true,
        table: 4,
      } as never);

      // 1 kg de molho = 1/10 do lote = 800 g de tomate.
      expect((await saldo(tomate.id)).toString()).toBe(
        antes.sub(800).toString(),
      );
    }, 30000);

    it('registra o custo do subproduto no histórico', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      const primeiro = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, primeiro.id);

      const segundo = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, segundo.id, { actualQuantity: '8' });

      const historico = await prisma.supplyCostHistory.findMany({
        where: { userId, supplyId: molhoSupply.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(historico).toHaveLength(2);
      expect(historico[0].source).toBe('PRODUCTION');
      expect(historico[0].unitCostBase.toString()).toBe('0.006');
      expect(historico[1].unitCostBase.toString()).toBe('0.0075');
      // 0,006 -> 0,0075 é uma alta de 25%.
      expect(historico[1].variationPercent.toString()).toBe('25');
    }, 30000);
  });

  // ---------------------------------------------------------------------------

  describe('transação e rollback', () => {
    /**
     * O motivo de produção ser uma transação só: sem ela, o tomate sairia e o
     * molho não entraria, e o estoque passaria a mentir nas duas pontas.
     */
    it('falta de insumo no meio do lote desfaz tudo', async () => {
      const tomate = await insumo('Tomate curto', 'G', '10', 'KG', '50');
      const cebola = await insumo('Cebola curta', 'G', '100', 'G', '1');
      const molhoSupply = await insumoVazio('Molho rollback', 'G');

      const ficha = await recipes.create(userId, {
        name: `Molho rollback ${next()}`,
        yieldQuantity: '10',
        yieldUnit: 'KG',
        outputSupplyId: molhoSupply.id,
        items: [
          { supplyId: tomate.id, quantity: '8', unit: 'KG' },
          // Só há 100 g de cebola em estoque: a segunda saída derruba o lote.
          { supplyId: cebola.id, quantity: '1', unit: 'KG' },
        ],
      });

      const antes = {
        tomate: await saldo(tomate.id),
        cebola: await saldo(cebola.id),
        molho: await saldo(molhoSupply.id),
      };

      const lote = await production.create(userId, { recipeId: ficha.id });

      await expect(production.confirm(userId, lote.id)).rejects.toThrow(
        InsufficientStockException,
      );

      // Nada se moveu: nem o tomate que já teria saído, nem o molho.
      expect((await saldo(tomate.id)).toString()).toBe(antes.tomate.toString());
      expect((await saldo(cebola.id)).toString()).toBe(antes.cebola.toString());
      expect((await saldo(molhoSupply.id)).toString()).toBe(
        antes.molho.toString(),
      );

      // E nenhuma movimentação sobrou no razão.
      expect(
        await prisma.stockMovement.count({
          where: { userId, referenceType: PRODUCTION_REFERENCE, referenceId: lote.id },
        }),
      ).toBe(0);

      // O lote continua rascunho e pode ser confirmado depois da reposição.
      const depois = await production.findOne(userId, lote.id);
      expect(depois.status).toBe(ProductionStatus.DRAFT);
    }, 30000);

    it('confirmar duas vezes não duplica a produção', async () => {
      const { molhoSupply, ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, lote.id);

      await expect(production.confirm(userId, lote.id)).rejects.toThrow(
        ConflictException,
      );

      expect((await saldo(molhoSupply.id)).toString()).toBe('10000');
    }, 30000);
  });

  // ---------------------------------------------------------------------------

  describe('histórico preservado', () => {
    it('cancela rascunho sem tocar no estoque', async () => {
      const { tomate, ficha } = await montarMolho();

      const antes = await saldo(tomate.id);
      const lote = await production.create(userId, { recipeId: ficha.id });
      const cancelado = await production.cancel(userId, lote.id);

      expect(cancelado.status).toBe(ProductionStatus.CANCELED);
      expect((await saldo(tomate.id)).toString()).toBe(antes.toString());
    }, 30000);

    /**
     * As movimentações do lote são históricas. O subproduto já pode ter virado
     * prato vendido, e apagar a entrada deixaria o razão sem explicar de onde
     * o molho consumido veio.
     */
    it('recusa cancelar lote confirmado e explica o caminho', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, lote.id);

      await expect(production.cancel(userId, lote.id)).rejects.toThrow(
        /never deleted/,
      );
    }, 30000);

    it('as movimentações do lote sobrevivem a tudo', async () => {
      const { ficha } = await montarMolho();

      const lote = await production.create(userId, { recipeId: ficha.id });
      await production.confirm(userId, lote.id);

      const antes = await prisma.stockMovement.count({
        where: { userId, referenceId: lote.id },
      });

      await production.cancel(userId, lote.id).catch(() => null);
      await production.confirm(userId, lote.id).catch(() => null);

      expect(
        await prisma.stockMovement.count({ where: { userId, referenceId: lote.id } }),
      ).toBe(antes);
    }, 30000);
  });

  // ---------------------------------------------------------------------------

  describe('validações', () => {
    it('recusa produzir ficha sem insumo de saída', async () => {
      const tomate = await insumo('Tomate avulso', 'G', '10', 'KG', '50');

      const semSaida = await recipes.create(userId, {
        name: `Molho sem saída ${next()}`,
        yieldQuantity: '10',
        yieldUnit: 'KG',
        items: [{ supplyId: tomate.id, quantity: '1', unit: 'KG' }],
      });

      await expect(
        production.create(userId, { recipeId: semSaida.id }),
      ).rejects.toThrow(/no output supply/);
    }, 30000);

    it('recusa ficha inexistente', async () => {
      await expect(
        production.create(userId, {
          recipeId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('recusa lotes zerados ou negativos', async () => {
      const { ficha } = await montarMolho();

      await expect(
        production.create(userId, { recipeId: ficha.id, batches: '0' }),
      ).rejects.toThrow(BadRequestException);
    }, 30000);

    it('não enxerga lote de outro estabelecimento', async () => {
      const { ficha } = await montarMolho();
      const lote = await production.create(userId, { recipeId: ficha.id });

      const outro = await prisma.user.create({
        data: {
          name: 'Vizinho',
          email: `vizinho-prod-${next()}@xfoods.test`,
          password: 'x',
        },
      });

      await expect(
        production.findOne(outro.id, lote.id),
      ).rejects.toThrow(NotFoundException);

      await prisma.user.delete({ where: { id: outro.id } });
    }, 30000);
  });
});
