import { Test, TestingModule } from '@nestjs/testing';
import { AllocationMethod, Prisma, SizeType } from '@prisma/client';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { AuthModule } from 'src/modules/auth/auth.module';
import { MeasurementUnitsModule } from 'src/modules/measurement-units/measurement-units.module';
import { StockModule } from 'src/modules/stock/stock.module';
import { SuppliesModule } from 'src/modules/supplies/supplies.module';
import { PurchasesModule } from 'src/modules/purchases/purchases.module';
import { RecipesModule } from 'src/modules/recipes/recipes.module';
import { OrdersModule } from 'src/modules/orders/orders.module';
import { ExpensesModule } from 'src/modules/expenses/expenses.module';
import { PricingModule } from 'src/modules/pricing/pricing.module';
import { SuppliesService } from 'src/modules/supplies/services/supplies.service';
import { PurchasesService } from 'src/modules/purchases/services/purchases.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { OrdersService } from 'src/modules/orders/orders.service';
import { StockService } from 'src/modules/stock/services/stock.service';
import { StockSettingsService } from 'src/modules/stock/services/stock-settings.service';
import { ExpensesService } from 'src/modules/expenses/services/expenses.service';
import { CostAllocationService } from 'src/modules/expenses/services/cost-allocation.service';
import { PricingSettingsService } from 'src/modules/pricing/services/pricing-settings.service';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './services/analytics.service';
import { SalesAggregationService } from './services/sales-aggregation.service';
import { ProductRanking } from './dto/analytics-query.dto';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 *
 * O cenário é montado uma vez e tem todos os números conferíveis à mão — é
 * assim que estes testes validam indicador, e não apenas "respondeu 200".
 *
 *   Pizza  : 10 un × R$ 25  = R$ 250 de receita, 200 g de queijo a R$ 0,035/g
 *            → R$ 7,00 de custo direto por unidade, R$ 70 no total
 *   Refri  : 15 un × R$ 10  = R$ 150 de receita, 500 ml a R$ 0,004/ml
 *            → R$ 2,00 por unidade, R$ 30 no total
 *
 *   Vendas : 25 unidades, R$ 400 de receita, R$ 100 de custo direto
 *   Despesa: R$ 6.000 de aluguel, estimativa de 2.000 un → R$ 3,00 por unidade
 *   Rateio : 25 × R$ 3 = R$ 75 absorvidos
 *   Total  : R$ 175 de custo
 *   Imposto: 6% de 400 = R$ 24   Taxas: 5% de 400 = R$ 20
 *   Lucro  : 400 − 175 − 24 − 20 = R$ 181   Margem: 45,25%
 */
describe('Indicadores gerenciais (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let salesAggregation: SalesAggregationService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let recipes: RecipesService;
  let orders: OrdersService;
  let stock: StockService;
  let stockSettings: StockSettingsService;
  let expenses: ExpensesService;
  let allocation: CostAllocationService;
  let pricingSettings: PricingSettingsService;

  let userId: string;
  let menuCategoryId: string;
  let pizzaId: string;
  let refriId: string;
  let queijoId: string;

  const TEST_EMAIL = 'analytics-integration@xfoods.test';

  /** Mês corrente, que é onde as vendas do teste caem. */
  const hoje = new Date();
  const PERIODO = {
    from: new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10),
    to: new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10),
  };

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

    await prisma.pricingSettings.deleteMany({ where: { userId: user.id } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.expenseCategory.deleteMany({ where: { userId: user.id } });
    await prisma.costAllocationSettings.deleteMany({
      where: { userId: user.id },
    });
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

  const vender = async (productId: string, quantity: number) => {
    const pedido = await orders.create(userId, {
      table: 5,
      description: null,
      leadId: undefined,
      status: undefined,
      paid: undefined,
      orderIds: undefined,
      products: [{ productId, quantity, size: SizeType.MEAN }],
    } as never);

    await orders.updateOrderPaid(userId, {
      orderIds: [pedido.id],
      paid: true,
      table: 5,
    } as never);

    return pedido;
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
        ExpensesModule,
        PricingModule,
        AnalyticsModule,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    analytics = moduleRef.get(AnalyticsService);
    salesAggregation = moduleRef.get(SalesAggregationService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    recipes = moduleRef.get(RecipesService);
    orders = moduleRef.get(OrdersService);
    stock = moduleRef.get(StockService);
    stockSettings = moduleRef.get(StockSettingsService);
    expenses = moduleRef.get(ExpensesService);
    allocation = moduleRef.get(CostAllocationService);
    pricingSettings = moduleRef.get(PricingSettingsService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Indicadores',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;

    const category = await prisma.category.create({
      data: { userId, name: 'Cardápio', icon: '🍕' },
    });
    menuCategoryId = category.id;

    await stockSettings.update(userId, {
      allowNegativeStock: true,
      allowSaleWithoutRecipe: true,
    });

    // --- insumos com custo redondo -----------------------------------------
    const queijo = await supplies.create(userId, {
      name: 'Queijo',
      baseUnit: 'G',
    });
    queijoId = queijo.id;

    const refrigerante = await supplies.create(userId, {
      name: 'Refrigerante',
      baseUnit: 'ML',
    });

    // 10 KG por R$ 350 = R$ 0,035/g; 20 L por R$ 80 = R$ 0,004/ml
    const compra = await purchases.create(userId, {
      items: [
        { supplyId: queijo.id, unit: 'KG', quantity: '10', totalPrice: '350' },
        {
          supplyId: refrigerante.id,
          unit: 'L',
          quantity: '20',
          totalPrice: '80',
        },
      ],
    });
    await purchases.confirm(userId, compra.id);

    // --- produtos e fichas --------------------------------------------------
    const pizza = await prisma.product.create({
      data: {
        userId,
        categoryId: menuCategoryId,
        name: 'Pizza Queijo',
        description: 'x',
        imagePath: 'x.png',
        price: new Prisma.Decimal('25'),
      },
    });
    pizzaId = pizza.id;

    const refri = await prisma.product.create({
      data: {
        userId,
        categoryId: menuCategoryId,
        name: 'Refrigerante Lata',
        description: 'x',
        imagePath: 'x.png',
        price: new Prisma.Decimal('10'),
      },
    });
    refriId = refri.id;

    await recipes.create(userId, {
      productId: pizza.id,
      items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
    });
    await recipes.create(userId, {
      productId: refri.id,
      items: [{ supplyId: refrigerante.id, quantity: '500', unit: 'ML' }],
    });

    // --- vendas -------------------------------------------------------------
    await vender(pizza.id, 10);
    await vender(refri.id, 15);

    // --- perda registrada: 500 g de queijo = R$ 17,50 ------------------------
    await stock.registerLoss(userId, {
      supplyId: queijo.id,
      quantity: '500',
      unit: 'G',
      reason: 'Queijo vencido',
    } as never);

    // --- despesas e percentuais ---------------------------------------------
    await expenses.create(userId, {
      description: 'Aluguel',
      amount: '6000',
      startDate: PERIODO.from,
    } as never);

    await allocation.updateSettings(userId, {
      method: AllocationMethod.PER_SOLD_UNIT,
      estimatedSalesUnits: '2000', // R$ 6.000 / 2.000 = R$ 3,00 por unidade
    });

    await pricingSettings.update(userId, {
      desiredMarginPercent: '30',
      taxPercent: '6',
      cardFeePercent: '5',
    });
  }, 60000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  // ---------------------------------------------------------------------------

  describe('indicadores gerais', () => {
    it('fatura R$ 400 com 25 unidades vendidas', async () => {
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.revenue.toString()).toBe('400');
      expect(painel.unitsSold.toString()).toBe('25');
    });

    it('mede R$ 100 de custo direto pelo congelado nas vendas', async () => {
      // 10 × R$ 7,00 + 15 × R$ 2,00
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.directCost.toString()).toBe('100');
    });

    it('rateia R$ 75 de custo indireto — 25 unidades a R$ 3,00', async () => {
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.indirectCost.toString()).toBe('75');
      expect(painel.totalCost.toString()).toBe('175');
    });

    it('desconta imposto e taxa da receita', async () => {
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.taxes.toString()).toBe('24'); // 6% de 400
      expect(painel.fees.toString()).toBe('20'); // 5% de 400
    });

    it('chega a R$ 181 de lucro e 45,25% de margem', async () => {
      // 400 − 175 − 24 − 20
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.estimatedProfit.toString()).toBe('181');
      expect(painel.marginPercent.toString()).toBe('45.25');
    });

    it('as partes somam a receita', async () => {
      const painel = await analytics.getOverview(userId, PERIODO);

      const soma = painel.totalCost
        .add(painel.taxes)
        .add(painel.fees)
        .add(painel.estimatedProfit);

      expect(soma.toString()).toBe(painel.revenue.toString());
    });

    it('avalia o estoque em R$ 312,50', async () => {
      // Queijo 7.500 g × 0,035 = 262,50; refri 12.500 ml × 0,004 = 50
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.stock.value.toString()).toBe('312.5');
    });

    it('contabiliza R$ 17,50 de perda registrada', async () => {
      // 500 g × R$ 0,035
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.waste.registeredLossCost.toString()).toBe('17.5');
      // Consumo real: R$ 100 de venda + R$ 17,50 de perda
      expect(painel.waste.consumptionCost.toString()).toBe('117.5');
      expect(painel.waste.lossShareOfConsumptionPercent.toString()).toBe(
        '14.89',
      );
    });

    /**
     * O número que impede o painel de mentir sobre o lucro: R$ 6.000 de
     * despesa contra R$ 75 absorvidos por 25 vendas. O resto é despesa real
     * que nenhuma venda pagou.
     */
    it('mostra quanto da despesa as vendas não absorveram', async () => {
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.indirectAbsorption.incurred.toString()).toBe('6000');
      expect(painel.indirectAbsorption.absorbed.toString()).toBe('75');
      expect(painel.indirectAbsorption.unabsorbed.toString()).toBe('5925');
    });

    it('reporta cobertura total do custo congelado', async () => {
      const painel = await analytics.getOverview(userId, PERIODO);

      expect(painel.dataQuality.itemsWithoutCostSnapshot).toBe(0);
      expect(painel.dataQuality.costCoveragePercent.toString()).toBe('100');
      expect(painel.dataQuality.warning).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------

  describe('ranking de produtos', () => {
    it('separa faturamento, custo, lucro e margem por prato', async () => {
      const ranking = await analytics.getProductRanking(userId, PERIODO);

      const pizza = ranking.items.find((item) => item.productId === pizzaId);
      const refri = ranking.items.find((item) => item.productId === refriId);

      // Pizza: 250 de receita, 70 direto, 30 indireto, 15 imposto, 12,50 taxa
      expect(pizza.revenue.toString()).toBe('250');
      expect(pizza.directCost.toString()).toBe('70');
      expect(pizza.indirectCost.toString()).toBe('30');
      expect(pizza.profit.toString()).toBe('122.5');
      expect(pizza.marginPercent.toString()).toBe('49');

      // Refri: 150 de receita, 30 direto, 45 indireto, 9 imposto, 7,50 taxa
      expect(refri.revenue.toString()).toBe('150');
      expect(refri.directCost.toString()).toBe('30');
      expect(refri.indirectCost.toString()).toBe('45');
      expect(refri.profit.toString()).toBe('58.5');
      expect(refri.marginPercent.toString()).toBe('39');
    });

    it('o lucro dos produtos soma o lucro geral', async () => {
      const ranking = await analytics.getProductRanking(userId, PERIODO);
      const painel = await analytics.getOverview(userId, PERIODO);

      const soma = ranking.items.reduce(
        (total, item) => total.add(item.profit),
        new Prisma.Decimal(0),
      );

      expect(soma.toString()).toBe(painel.estimatedProfit.toString());
    });

    it('calcula a economia de uma unidade', async () => {
      const ranking = await analytics.getProductRanking(userId, PERIODO);
      const pizza = ranking.items.find((item) => item.productId === pizzaId);

      expect(pizza.pricePerUnit.toString()).toBe('25');
      expect(pizza.directCostPerUnit.toString()).toBe('7');
      expect(pizza.indirectCostPerUnit.toString()).toBe('3');
      expect(pizza.totalCostPerUnit.toString()).toBe('10');
      expect(pizza.profitPerUnit.toString()).toBe('12.25');
    });

    it('ordena por faturamento', async () => {
      const ranking = await analytics.getProductRanking(userId, {
        ...PERIODO,
        rankBy: ProductRanking.REVENUE,
      });

      expect(ranking.items.map((item) => item.productId)).toEqual([
        pizzaId,
        refriId,
      ]);
    });

    /** Quantidade e faturamento discordam: é o motivo de existirem dois rankings. */
    it('ordena por quantidade, que inverte a ordem do faturamento', async () => {
      const ranking = await analytics.getProductRanking(userId, {
        ...PERIODO,
        rankBy: ProductRanking.QUANTITY,
      });

      expect(ranking.items.map((item) => item.productId)).toEqual([
        refriId,
        pizzaId,
      ]);
    });

    it('ordena por lucro, por custo e pelas duas pontas da margem', async () => {
      const porLucro = await analytics.getProductRanking(userId, {
        ...PERIODO,
        rankBy: ProductRanking.PROFIT,
      });
      const porCusto = await analytics.getProductRanking(userId, {
        ...PERIODO,
        rankBy: ProductRanking.COST,
      });
      const maiorMargem = await analytics.getProductRanking(userId, {
        ...PERIODO,
        rankBy: ProductRanking.MARGIN_HIGH,
      });
      const menorMargem = await analytics.getProductRanking(userId, {
        ...PERIODO,
        rankBy: ProductRanking.MARGIN_LOW,
      });

      expect(porLucro.items[0].productId).toBe(pizzaId); // 122,50 > 58,50
      expect(porCusto.items[0].productId).toBe(pizzaId); // 100 > 75
      expect(maiorMargem.items[0].productId).toBe(pizzaId); // 49% > 39%
      expect(menorMargem.items[0].productId).toBe(refriId);
    });

    it('pagina o ranking', async () => {
      const primeira = await analytics.getProductRanking(userId, {
        ...PERIODO,
        limit: 1,
      });
      const segunda = await analytics.getProductRanking(userId, {
        ...PERIODO,
        limit: 1,
        offset: 1,
      });

      expect(primeira.items).toHaveLength(1);
      expect(primeira.total).toBe(2);
      expect(segunda.items[0].productId).not.toBe(primeira.items[0].productId);
    });
  });

  // ---------------------------------------------------------------------------

  describe('detalhe do produto', () => {
    it('mostra preço, custo, lucro, margem e recomendação juntos', async () => {
      const detalhe = await analytics.getProductDetail(
        userId,
        pizzaId,
        PERIODO,
      );

      expect(detalhe.currentPrice.toString()).toBe('25');
      expect(detalhe.sales.unitsSold.toString()).toBe('10');
      expect(detalhe.sales.revenue.toString()).toBe('250');

      expect(detalhe.unitEconomics.costBasis).toBe('REALIZED');
      expect(detalhe.unitEconomics.price.toString()).toBe('25');
      expect(detalhe.unitEconomics.directCost.toString()).toBe('7');
      expect(detalhe.unitEconomics.indirectCost.toString()).toBe('3');
      expect(detalhe.unitEconomics.totalCost.toString()).toBe('10');
      expect(detalhe.unitEconomics.taxes.toString()).toBe('1.5');
      expect(detalhe.unitEconomics.fees.toString()).toBe('1.25');
      expect(detalhe.unitEconomics.profit.toString()).toBe('12.25');
      expect(detalhe.unitEconomics.marginPercent.toString()).toBe('49');

      // Custo completo R$ 10 / (1 − 0,06 − 0,05 − 0,30) = R$ 16,95
      expect(detalhe.recommendedPrice.toString()).toBe('16.95');
      expect(detalhe.priceStatus).toBe('ACIMA_DO_RECOMENDADO');
    });

    it('cai para a ficha atual quando o prato não vendeu no período', async () => {
      const novo = await prisma.product.create({
        data: {
          userId,
          categoryId: menuCategoryId,
          name: 'Pizza Nova',
          description: 'x',
          imagePath: 'x.png',
          price: new Prisma.Decimal('30'),
        },
      });

      await recipes.create(userId, {
        productId: novo.id,
        items: [{ supplyId: queijoId, quantity: '100', unit: 'G' }],
      });

      const detalhe = await analytics.getProductDetail(userId, novo.id, PERIODO);

      expect(detalhe.sales.unitsSold.toString()).toBe('0');
      expect(detalhe.unitEconomics.costBasis).toBe('CURRENT_RECIPE');
      // Mesmos campos do caminho realizado: quem lê não precisa ramificar.
      expect(detalhe.unitEconomics.price.toString()).toBe('30');
      expect(detalhe.unitEconomics.directCost.toString()).toBe('3.5');
      expect(detalhe.unitEconomics.indirectCost.toString()).toBe('3');
      expect(detalhe.unitEconomics.totalCost.toString()).toBe('6.5');
      expect(detalhe.unitEconomics.marginPercent).not.toBeNull();

      await prisma.recipeItem.deleteMany({ where: { recipe: { productId: novo.id } } });
      await prisma.recipe.deleteMany({ where: { productId: novo.id } });
      await prisma.product.delete({ where: { id: novo.id } });
    });
  });

  // ---------------------------------------------------------------------------

  describe('painel de estoque', () => {
    it('soma o valor do estoque e conta as situações', async () => {
      const painel = await analytics.getStockDashboard(userId, PERIODO);

      expect(painel.totalValue.toString()).toBe('312.5');
      expect(painel.counts.supplies).toBe(2);
      expect(painel.counts.negative).toBe(0);
      expect(painel.counts.zero).toBe(0);
    });

    it('lista os maiores consumos por valor', async () => {
      const painel = await analytics.getStockDashboard(userId, PERIODO);

      // Queijo saiu R$ 70 em venda; refrigerante, R$ 30.
      expect(painel.topConsumption[0].supplyName).toBe('Queijo');
      expect(painel.topConsumption[0].cost.toString()).toBe('70');
      expect(painel.topConsumption[0].quantityBase.toString()).toBe('2000');
      expect(painel.topConsumption[1].cost.toString()).toBe('30');
    });

    it('lista as maiores perdas', async () => {
      const painel = await analytics.getStockDashboard(userId, PERIODO);

      expect(painel.topLosses).toHaveLength(1);
      expect(painel.topLosses[0].supplyName).toBe('Queijo');
      expect(painel.topLosses[0].cost.toString()).toBe('17.5');
    });

    it('quebra o consumo por tipo de movimentação', async () => {
      const painel = await analytics.getStockDashboard(userId, PERIODO);

      const venda = painel.consumptionByMovementType.find(
        (row) => row.type === 'SALE',
      );
      const perda = painel.consumptionByMovementType.find(
        (row) => row.type === 'LOSS',
      );

      expect(venda.cost.toString()).toBe('100');
      expect(perda.cost.toString()).toBe('17.5');
    });

    it('acusa item abaixo do mínimo', async () => {
      await prisma.supply.update({
        where: { id: queijoId },
        data: { minStock: new Prisma.Decimal('9000') },
      });

      const painel = await analytics.getStockDashboard(userId, PERIODO);

      expect(painel.counts.belowMinimum).toBe(1);
      expect(painel.alerts[0].name).toBe('Queijo');

      await prisma.supply.update({
        where: { id: queijoId },
        data: { minStock: new Prisma.Decimal('0') },
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('painel de custos', () => {
    it('soma custo direto e indireto', async () => {
      const painel = await analytics.getCostDashboard(userId, PERIODO);

      expect(painel.directCost.toString()).toBe('100');
      expect(painel.indirectCost.toString()).toBe('75');
      expect(painel.totalCost.toString()).toBe('175');
    });

    it('calcula o custo médio por unidade vendida', async () => {
      const painel = await analytics.getCostDashboard(userId, PERIODO);

      expect(painel.averageCostPerUnit.toString()).toBe('7'); // 175 / 25
      expect(painel.averageDirectCostPerUnit.toString()).toBe('4'); // 100 / 25
    });

    /**
     * Estimado x Real em dinheiro, por agregação: o SUM do custo congelado nas
     * vendas contra o SUM do razão. A perda de R$ 17,50 é exatamente o desvio.
     */
    it('confronta estimado e real, e o desvio é a perda lançada', async () => {
      const painel = await analytics.getCostDashboard(userId, PERIODO);

      expect(painel.estimatedVsReal.estimatedConsumptionCost.toString()).toBe(
        '100',
      );
      expect(painel.estimatedVsReal.realConsumptionCost.toString()).toBe(
        '117.5',
      );
      expect(painel.estimatedVsReal.deviationCost.toString()).toBe('17.5');
      expect(painel.estimatedVsReal.deviationPercent.toString()).toBe('17.5');
    });

    it('mede o desperdício contra o consumo total', async () => {
      const painel = await analytics.getCostDashboard(userId, PERIODO);

      expect(painel.waste.registeredLossCost.toString()).toBe('17.5');
      expect(painel.waste.shareOfConsumptionPercent.toString()).toBe('14.89');
    });

    it('traz a variação de custo dos insumos', async () => {
      const painel = await analytics.getCostDashboard(userId, PERIODO);

      // Só houve uma compra de cada insumo: nada com que comparar ainda.
      expect(painel.costVariation.summary.firstPurchase).toBe(2);
      expect(painel.costVariation.topIncreases).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------

  describe('alertas', () => {
    it('aponta prato com margem realizada abaixo da desejada', async () => {
      const alertas = await analytics.getAlerts(userId, PERIODO);

      // Refri entrega 39% contra os 30% pedidos — está acima, não entra.
      // Nenhum dos dois fica abaixo, então a lista vem vazia.
      expect(alertas.productsBelowTargetMargin).toHaveLength(0);

      // Com a meta em 45%, o refri (39%) passa a ser alerta.
      const exigente = await analytics.getAlerts(userId, PERIODO);
      await pricingSettings.update(userId, { desiredMarginPercent: '45' });

      const depois = await analytics.getAlerts(userId, PERIODO);
      expect(
        depois.productsBelowTargetMargin.map((item) => item.productId),
      ).toContain(refriId);

      await pricingSettings.update(userId, { desiredMarginPercent: '30' });
      expect(exigente).toBeTruthy();
    });

    it('aponta prato abaixo do preço recomendado', async () => {
      const barato = await prisma.product.create({
        data: {
          userId,
          categoryId: menuCategoryId,
          name: 'Pizza Barata',
          description: 'x',
          imagePath: 'x.png',
          price: new Prisma.Decimal('9'),
        },
      });

      await recipes.create(userId, {
        productId: barato.id,
        items: [{ supplyId: queijoId, quantity: '200', unit: 'G' }],
      });

      const alertas = await analytics.getAlerts(userId, PERIODO);

      expect(
        alertas.productsBelowRecommendedPrice.map((item) => item.productId),
      ).toContain(barato.id);

      // E o mesmo prato, com custo completo de R$ 10 sobre preço de R$ 9,
      // estoura qualquer limiar de custo elevado.
      expect(
        alertas.productsWithHighCost.map((item) => item.productId),
      ).toContain(barato.id);

      await prisma.recipeItem.deleteMany({
        where: { recipe: { productId: barato.id } },
      });
      await prisma.recipe.deleteMany({ where: { productId: barato.id } });
      await prisma.product.delete({ where: { id: barato.id } });
    });

    it('lista produtos sem ficha técnica', async () => {
      const semFicha = await prisma.product.create({
        data: {
          userId,
          categoryId: menuCategoryId,
          name: 'Água',
          description: 'x',
          imagePath: 'x.png',
          price: new Prisma.Decimal('5'),
        },
      });

      const alertas = await analytics.getAlerts(userId, PERIODO);

      expect(
        alertas.productsWithoutRecipe.map((item) => item.id),
      ).toContain(semFicha.id);

      await prisma.product.delete({ where: { id: semFicha.id } });
    });

    it('lista insumos com desperdício acima do limiar', async () => {
      const alertas = await analytics.getAlerts(userId, {
        ...PERIODO,
        wasteThresholdCost: '10',
      });

      expect(alertas.suppliesWithHighWaste.map((item) => item.supplyName)).toEqual(
        ['Queijo'],
      );

      const exigente = await analytics.getAlerts(userId, {
        ...PERIODO,
        wasteThresholdCost: '50',
      });
      expect(exigente.suppliesWithHighWaste).toHaveLength(0);
    });

    it('aponta insumo que encareceu acima do limiar', async () => {
      // Segunda compra do queijo a R$ 0,050/g: alta de 42,86%.
      const compra = await purchases.create(userId, {
        items: [
          { supplyId: queijoId, unit: 'KG', quantity: '10', totalPrice: '500' },
        ],
      });
      await purchases.confirm(userId, compra.id);

      const alertas = await analytics.getAlerts(userId, {
        ...PERIODO,
        costIncreaseThresholdPercent: '10',
      });

      const queijo = alertas.suppliesWithCostIncrease.find(
        (item) => item.supplyId === queijoId,
      );

      expect(queijo).toBeTruthy();
      expect(Number(queijo.variationPercent)).toBeCloseTo(42.86, 1);

      const tolerante = await analytics.getAlerts(userId, {
        ...PERIODO,
        costIncreaseThresholdPercent: '50',
      });
      expect(
        tolerante.suppliesWithCostIncrease.map((item) => item.supplyId),
      ).not.toContain(queijoId);
    });

    it('o limiar de custo elevado é configurável', async () => {
      // Pizza tem custo completo de R$ 10 sobre preço de R$ 25 = 40%.
      const rigoroso = await analytics.getAlerts(userId, {
        ...PERIODO,
        highCostThresholdPercent: '35',
      });
      const frouxo = await analytics.getAlerts(userId, {
        ...PERIODO,
        highCostThresholdPercent: '95',
      });

      expect(
        rigoroso.productsWithHighCost.map((item) => item.productId),
      ).toContain(pizzaId);
      expect(
        frouxo.productsWithHighCost.map((item) => item.productId),
      ).not.toContain(pizzaId);
    });
  });

  // ---------------------------------------------------------------------------

  describe('filtros', () => {
    it('recorta por produto', async () => {
      const painel = await analytics.getOverview(userId, {
        ...PERIODO,
        productId: pizzaId,
      });

      expect(painel.revenue.toString()).toBe('250');
      expect(painel.unitsSold.toString()).toBe('10');
    });

    it('recorta por categoria do cardápio', async () => {
      const outra = await prisma.category.create({
        data: { userId, name: 'Sobremesas', icon: '🍰' },
      });

      const painel = await analytics.getOverview(userId, {
        ...PERIODO,
        categoryId: outra.id,
      });

      expect(painel.revenue.toString()).toBe('0');

      await prisma.category.delete({ where: { id: outra.id } });
    });

    it('recorta por insumo no painel de estoque', async () => {
      const painel = await analytics.getStockDashboard(userId, {
        ...PERIODO,
        supplyId: queijoId,
      });

      expect(painel.topConsumption).toHaveLength(1);
      expect(painel.topConsumption[0].supplyId).toBe(queijoId);
    });

    it('recorta por período', async () => {
      const antigo = await analytics.getOverview(userId, {
        from: '2020-01-01',
        to: '2020-01-31',
      });

      expect(antigo.revenue.toString()).toBe('0');
      expect(antigo.unitsSold.toString()).toBe('0');
    });
  });

  // ---------------------------------------------------------------------------

  describe('agregação no banco', () => {
    /**
     * O requisito de performance, testado diretamente: o painel não pode
     * carregar venda para a memória. Se carregasse, o número de consultas ou o
     * volume trafegado cresceria com o movimento.
     *
     * A prova é que o GROUP BY devolve uma linha por PRODUTO, não por venda:
     * quarenta pedidos a mais não mudam o tamanho do resultado.
     */
    it('o agrupamento devolve uma linha por produto, não por venda', async () => {
      const antes = await salesAggregation.byProduct(
        userId,
        {
          from: new Date(`${PERIODO.from}T00:00:00.000Z`),
          to: new Date(`${PERIODO.to}T00:00:00.000Z`),
        },
        {},
      );

      const itensAntes = await prisma.productOrder.count({ where: { userId } });

      for (let i = 0; i < 20; i += 1) {
        await vender(pizzaId, 1);
      }

      const itensDepois = await prisma.productOrder.count({ where: { userId } });
      const depois = await salesAggregation.byProduct(
        userId,
        {
          from: new Date(`${PERIODO.from}T00:00:00.000Z`),
          to: new Date(`${PERIODO.to}T00:00:00.000Z`),
        },
        {},
      );

      expect(itensDepois).toBe(itensAntes + 20);
      // Vinte vendas a mais, o mesmo número de linhas no resultado.
      expect(depois.length).toBe(antes.length);

      // E os totais acompanharam: 20 pizzas a R$ 25.
      const pizzaAntes = antes.find((row) => row.productId === pizzaId);
      const pizzaDepois = depois.find((row) => row.productId === pizzaId);

      expect(
        pizzaDepois.revenue.sub(pizzaAntes.revenue).toString(),
      ).toBe('500');
      expect(pizzaDepois.units.sub(pizzaAntes.units).toString()).toBe('20');
    }, 60000);

    it('o painel faz o mesmo número de consultas com mais vendas', async () => {
      const contar = async (fn: () => Promise<unknown>) => {
        let queries = 0;
        const contador: Prisma.Middleware = async (params, nextFn) => {
          queries += 1;
          return nextFn(params);
        };

        prisma.$use(contador);
        await fn();

        return queries;
      };

      const antes = await contar(() => analytics.getOverview(userId, PERIODO));

      for (let i = 0; i < 20; i += 1) {
        await vender(refriId, 1);
      }

      const depois = await contar(() => analytics.getOverview(userId, PERIODO));

      expect(depois).toBe(antes);
    }, 60000);
  });

  // ---------------------------------------------------------------------------

  describe('só leitura', () => {
    it('nenhum painel escreve no banco', async () => {
      const contagens = async () => ({
        movimentos: await prisma.stockMovement.count({ where: { userId } }),
        pedidos: await prisma.order.count({ where: { userId } }),
        itens: await prisma.productOrder.count({ where: { userId } }),
        despesas: await prisma.expense.count({ where: { userId } }),
        produtos: await prisma.product.count({ where: { userId } }),
      });

      const antes = await contagens();
      const precos = await prisma.product.findMany({
        where: { userId },
        select: { id: true, price: true },
        orderBy: { id: 'asc' },
      });

      await analytics.getOverview(userId, PERIODO);
      await analytics.getProductRanking(userId, PERIODO);
      await analytics.getProductDetail(userId, pizzaId, PERIODO);
      await analytics.getAlerts(userId, PERIODO);
      await analytics.getStockDashboard(userId, PERIODO);
      await analytics.getCostDashboard(userId, PERIODO);

      expect(await contagens()).toEqual(antes);

      const depois = await prisma.product.findMany({
        where: { userId },
        select: { id: true, price: true },
        orderBy: { id: 'asc' },
      });
      expect(depois.map((p) => p.price.toString())).toEqual(
        precos.map((p) => p.price.toString()),
      );
    }, 30000);
  });
});
