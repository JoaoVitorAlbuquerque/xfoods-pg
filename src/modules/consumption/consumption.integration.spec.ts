import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, SizeType, StockMovementType } from '@prisma/client';

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
import { StockService } from 'src/modules/stock/services/stock.service';
import { StockSettingsService } from 'src/modules/stock/services/stock-settings.service';
import { OrdersService } from 'src/modules/orders/orders.service';
import { ConsumptionModule } from './consumption.module';
import { ConsumptionReportService } from './services/consumption-report.service';
import { ConsumptionClassification } from './services/consumption-analysis.service';
import { PeriodGrouping } from './dto/consumption-report.dto';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 *
 * Todos os testes compartilham o mesmo usuário, então cada um filtra pelo
 * próprio insumo ou produto — sem isso, um relatório de período somaria as
 * vendas de todos os outros casos.
 */
describe('Consumo estimado x real (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let recipes: RecipesService;
  let orders: OrdersService;
  let stock: StockService;
  let settings: StockSettingsService;
  let report: ConsumptionReportService;
  let userId: string;
  let categoryId: string;

  const TEST_EMAIL = 'consumption-integration@xfoods.test';

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

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
        // O gateway de pedidos depende do JwtService, que o AuthModule
        // registra globalmente.
        AuthModule,
        MeasurementUnitsModule,
        StockModule,
        SuppliesModule,
        PurchasesModule,
        RecipesModule,
        OrdersModule,
        ConsumptionModule,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    recipes = moduleRef.get(RecipesService);
    orders = moduleRef.get(OrdersService);
    stock = moduleRef.get(StockService);
    settings = moduleRef.get(StockSettingsService);
    report = moduleRef.get(ConsumptionReportService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Consumo',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;

    const category = await prisma.category.create({
      data: { userId, name: 'Pizzas', icon: '🍕' },
    });

    categoryId = category.id;

    await settings.update(userId, {
      allowNegativeStock: false,
      allowSaleWithoutRecipe: true,
      stockConsumptionTolerancePercentage: '5',
    });
  }, 30000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  // ---------------------------------------------------------------------------

  let seq = 0;
  const next = () => (seq += 1);

  const novoProduto = (name: string, price = '50', category = categoryId) =>
    prisma.product.create({
      data: {
        userId,
        categoryId: category,
        name: `${name} ${next()}`,
        description: name,
        imagePath: 'x.png',
        price: new Prisma.Decimal(price),
      },
    });

  /** Insumo com custo conhecido e estoque abastecido por uma compra. */
  const insumo = async (
    name: string,
    baseUnit: string,
    quantity: string,
    unit: string,
    totalPrice: string,
    supplyCategoryId?: string,
  ) => {
    const supply = await supplies.create(userId, {
      name: `${name} ${next()}`,
      baseUnit,
      ...(supplyCategoryId ? { supplyCategoryId } : {}),
    });

    const compra = await purchases.create(userId, {
      items: [{ supplyId: supply.id, unit, quantity, totalPrice }],
    });
    await purchases.confirm(userId, compra.id);

    return supply;
  };

  const vender = async (
    productId: string,
    quantity: number,
    size: SizeType = SizeType.MEAN,
  ) => {
    const pedido = await orders.create(userId, {
      table: 10,
      description: null,
      leadId: undefined,
      status: undefined,
      paid: undefined,
      orderIds: undefined,
      products: [{ productId, quantity, size }],
    } as never);

    await orders.updateOrderPaid(userId, {
      orderIds: [pedido.id],
      paid: true,
      table: 10,
    } as never);

    return pedido;
  };

  const perder = (supplyId: string, quantity: string, unit: string) =>
    stock.registerLoss(userId, {
      supplyId,
      quantity,
      unit,
      reason: 'Descarte de teste',
    } as never);

  /** Uma linha do relatório por insumo, isolada pelo filtro de insumo. */
  const linhaDoInsumo = async (supplyId: string) => {
    const result = await report.bySupply(userId, { supplyId });

    expect(result.items).toHaveLength(1);

    return result.items[0];
  };

  // ---------------------------------------------------------------------------

  describe('o exemplo do enunciado', () => {
    let calabresa: { id: string };
    let pizza: { id: string };

    beforeAll(async () => {
      // R$ 28/kg = R$ 0,028/g, com o saldo guardado em grama.
      calabresa = await insumo('Calabresa', 'G', '100', 'KG', '2800');
      pizza = await novoProduto('Pizza Calabresa');

      await recipes.create(userId, {
        productId: pizza.id,
        items: [{ supplyId: calabresa.id, quantity: '250', unit: 'G' }],
      });

      await vender(pizza.id, 100);
      await perder(calabresa.id, '2', 'KG');
    }, 30000);

    it('estima 25 kg a partir de 100 vendas × 250 g de ficha', async () => {
      const linha = await linhaDoInsumo(calabresa.id);

      expect(linha.estimatedQuantity.toString()).toBe('25000');
    });

    it('mede 27 kg de consumo real somando venda e perda', async () => {
      const linha = await linhaDoInsumo(calabresa.id);

      expect(linha.realQuantity.toString()).toBe('27000');
      expect(linha.realByMovementType[StockMovementType.SALE].toString()).toBe(
        '25000',
      );
      expect(linha.realByMovementType[StockMovementType.LOSS].toString()).toBe(
        '2000',
      );
    });

    it('acusa diferença de +2 kg e variação de +8%', async () => {
      const linha = await linhaDoInsumo(calabresa.id);

      expect(linha.difference.toString()).toBe('2000');
      expect(linha.variationPercent.toString()).toBe('8');
      expect(linha.classification).toBe(
        ConsumptionClassification.ACIMA_DO_ESPERADO,
      );
    });

    it('custa R$ 56 pelo custo atual do insumo', async () => {
      const linha = await linhaDoInsumo(calabresa.id);

      expect(linha.unitCost.toString()).toBe('0.028');
      expect(linha.differenceCost.toString()).toBe('56');
    });

    it('atribui o desvio inteiro à perda já registrada', async () => {
      // O ponto do relatório: os 2 kg não são desperdício misterioso, são a
      // perda que alguém lançou. Nada sobra para investigar.
      const linha = await linhaDoInsumo(calabresa.id);

      expect(linha.deviationBreakdown.documented.toString()).toBe('2000');
      expect(linha.deviationBreakdown.undocumented.toString()).toBe('0');
    });
  });

  // ---------------------------------------------------------------------------

  describe('cálculo do estimado', () => {
    it('sem lançamento extra, estimado e real coincidem', async () => {
      const queijo = await insumo('Queijo', 'G', '10', 'KG', '350');
      const produto = await novoProduto('Pizza Queijo');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      await vender(produto.id, 5);

      const linha = await linhaDoInsumo(queijo.id);

      expect(linha.estimatedQuantity.toString()).toBe('1000');
      expect(linha.realQuantity.toString()).toBe('1000');
      expect(linha.difference.isZero()).toBe(true);
      expect(linha.classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    it('aplica o multiplicador de tamanho da ficha', async () => {
      const massa = await insumo('Massa', 'G', '50', 'KG', '250');
      const produto = await novoProduto('Pizza Tamanhos');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: massa.id, quantity: '400', unit: 'G' }],
        sizeFactors: [
          { size: SizeType.TINY, factor: '0.5' },
          { size: SizeType.LARGE, factor: '1.5' },
        ],
      });

      await vender(produto.id, 1, SizeType.TINY);
      await vender(produto.id, 1, SizeType.LARGE);

      // 400 × 0,5 + 400 × 1,5 = 200 + 600
      const linha = await linhaDoInsumo(massa.id);

      expect(linha.estimatedQuantity.toString()).toBe('800');
    });

    it('desdobra sub-receitas até o insumo', async () => {
      const tomate = await insumo('Tomate', 'G', '50', 'KG', '250');
      const molho = await recipes.create(userId, {
        name: `Molho ${next()}`,
        yieldQuantity: '4000',
        yieldUnit: 'ML',
        items: [{ supplyId: tomate.id, quantity: '2000', unit: 'G' }],
      });

      const produto = await novoProduto('Pizza Molho');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ subRecipeId: molho.id, quantity: '100', unit: 'ML' }],
      });

      await vender(produto.id, 4);

      // 100 ML de um molho que rende 4000 ML = 1/40 dos 2000 g de tomate = 50 g
      const linha = await linhaDoInsumo(tomate.id);

      expect(linha.estimatedQuantity.toString()).toBe('200');
    });

    /**
     * O estimado sai da ficha congelada na venda, não da ficha de hoje. Sem
     * isso, editar a receita reescreveria o desvio de todos os meses passados.
     */
    it('usa a ficha congelada na venda, não a ativa de hoje', async () => {
      const bacon = await insumo('Bacon', 'G', '20', 'KG', '600');
      const produto = await novoProduto('Pizza Bacon');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: bacon.id, quantity: '100', unit: 'G' }],
      });

      await vender(produto.id, 10);

      const antes = await linhaDoInsumo(bacon.id);
      expect(antes.estimatedQuantity.toString()).toBe('1000');

      // Ficha nova com o dobro do bacon, ativada depois da venda.
      const v2 = await recipes.newVersion(userId, ficha.id, {
        items: [{ supplyId: bacon.id, quantity: '200', unit: 'G' }],
      });
      await recipes.activate(userId, v2.id);

      const depois = await linhaDoInsumo(bacon.id);

      expect(depois.estimatedQuantity.toString()).toBe('1000');
      expect(depois.difference.isZero()).toBe(true);
    });

    it('ignora venda cancelada nos dois lados', async () => {
      const cebola = await insumo('Cebola', 'G', '10', 'KG', '80');
      const produto = await novoProduto('Pizza Cebola');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: cebola.id, quantity: '100', unit: 'G' }],
      });

      const pedido = await vender(produto.id, 3);
      await orders.cancel(userId, pedido.id);

      const linha = await linhaDoInsumo(cebola.id);

      // O pedido sai do estimado, e no razão a venda e o estorno se anulam.
      expect(linha.estimatedQuantity.isZero()).toBe(true);
      expect(linha.realQuantity.isZero()).toBe(true);
      expect(linha.classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    it('sinaliza produto vendido sem ficha ativa', async () => {
      const produto = await novoProduto('Prato Sem Ficha');

      await vender(produto.id, 2);

      const result = await report.bySupply(userId, { productId: produto.id });

      expect(
        result.summary.productsWithoutRecipe.map((item) => item.productId),
      ).toContain(produto.id);
      expect(result.interpretation.caveats.join(' ')).toContain(
        'sem ficha ativa',
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('cálculo do real', () => {
    it('conta ajuste de inventário como consumo', async () => {
      const azeitona = await insumo('Azeitona', 'G', '10', 'KG', '400');
      const produto = await novoProduto('Pizza Azeitona');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: azeitona.id, quantity: '50', unit: 'G' }],
      });

      await vender(produto.id, 10); // estimado 500 g

      // Contagem física encontrou 300 g a menos do que o sistema dizia.
      const saldo = await prisma.supply.findUnique({
        where: { id: azeitona.id },
        select: { currentStock: true },
      });

      await stock.registerAdjustment(userId, {
        supplyId: azeitona.id,
        targetQuantity: new Prisma.Decimal(saldo.currentStock)
          .sub(300)
          .toString(),
        unit: 'G',
        reason: 'Inventário',
      } as never);

      const linha = await linhaDoInsumo(azeitona.id);

      expect(linha.estimatedQuantity.toString()).toBe('500');
      expect(linha.realQuantity.toString()).toBe('800');
      expect(
        linha.realByMovementType[StockMovementType.ADJUSTMENT].toString(),
      ).toBe('300');
      expect(linha.deviationBreakdown.documented.toString()).toBe('300');
    });

    it('um ajuste que devolve saldo reduz o consumo real', async () => {
      const oregano = await insumo('Orégano', 'G', '5', 'KG', '100');
      const produto = await novoProduto('Pizza Orégano');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: oregano.id, quantity: '10', unit: 'G' }],
      });

      await vender(produto.id, 10); // estimado 100 g

      const saldo = await prisma.supply.findUnique({
        where: { id: oregano.id },
        select: { currentStock: true },
      });

      // Contagem encontrou 40 g a mais: o sistema tinha baixado demais.
      await stock.registerAdjustment(userId, {
        supplyId: oregano.id,
        targetQuantity: new Prisma.Decimal(saldo.currentStock)
          .add(40)
          .toString(),
        unit: 'G',
        reason: 'Inventário',
      } as never);

      const linha = await linhaDoInsumo(oregano.id);

      expect(linha.realQuantity.toString()).toBe('60');
      expect(linha.difference.toString()).toBe('-40');
      expect(linha.classification).toBe(
        ConsumptionClassification.ABAIXO_DO_ESPERADO,
      );
    });

    it('não conta compra como consumo', async () => {
      const farinha = await insumo('Farinha', 'G', '10', 'KG', '50');
      const produto = await novoProduto('Pizza Farinha');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: farinha.id, quantity: '100', unit: 'G' }],
      });

      await vender(produto.id, 2);

      // Reposição no meio do período: não pode aparecer como consumo negativo.
      const reposicao = await purchases.create(userId, {
        items: [
          {
            supplyId: farinha.id,
            unit: 'KG',
            quantity: '10',
            totalPrice: '50',
          },
        ],
      });
      await purchases.confirm(userId, reposicao.id);

      const linha = await linhaDoInsumo(farinha.id);

      expect(linha.realQuantity.toString()).toBe('200');
      expect(linha.realByMovementType[StockMovementType.PURCHASE]).toBeUndefined();
    });

    it('acusa insumo consumido sem nenhuma venda prevista', async () => {
      const gelo = await insumo('Gelo', 'G', '10', 'KG', '20');

      await perder(gelo.id, '500', 'G');

      const linha = await linhaDoInsumo(gelo.id);

      expect(linha.estimatedQuantity.isZero()).toBe(true);
      expect(linha.realQuantity.toString()).toBe('500');
      // Sem base, não há porcentagem — mas continua sendo desvio.
      expect(linha.variationPercent).toBeNull();
      expect(linha.classification).toBe(
        ConsumptionClassification.ACIMA_DO_ESPERADO,
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('tolerância', () => {
    let pimenta: { id: string };

    beforeAll(async () => {
      pimenta = await insumo('Pimenta', 'G', '10', 'KG', '200');
      const produto = await novoProduto('Pizza Pimenta');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: pimenta.id, quantity: '100', unit: 'G' }],
      });

      await vender(produto.id, 10); // estimado 1000 g
      await perder(pimenta.id, '30', 'G'); // real 1030 g, +3%
    }, 30000);

    afterAll(async () => {
      await settings.update(userId, {
        stockConsumptionTolerancePercentage: '5',
      });
    });

    it('absorve 3% de desvio com tolerância de 5%', async () => {
      await settings.update(userId, {
        stockConsumptionTolerancePercentage: '5',
      });

      const linha = await linhaDoInsumo(pimenta.id);

      expect(linha.variationPercent.toString()).toBe('3');
      expect(linha.classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    it('o mesmo desvio vira alerta com tolerância de 2%', async () => {
      await settings.update(userId, {
        stockConsumptionTolerancePercentage: '2',
      });

      const linha = await linhaDoInsumo(pimenta.id);

      expect(linha.classification).toBe(
        ConsumptionClassification.ACIMA_DO_ESPERADO,
      );
    });

    it('a tolerância vigente acompanha o relatório', async () => {
      await settings.update(userId, {
        stockConsumptionTolerancePercentage: '7.5',
      });

      const result = await report.bySupply(userId, { supplyId: pimenta.id });

      expect(result.summary.tolerancePercent.toString()).toBe('7.5');
    });
  });

  // ---------------------------------------------------------------------------

  describe('filtros', () => {
    let bebidas: { id: string };
    let refri: { id: string };
    let suco: { id: string };
    let produtoRefri: { id: string };

    beforeAll(async () => {
      bebidas = await prisma.supplyCategory.create({
        data: { userId, name: `Bebidas ${next()}` },
      });

      refri = await insumo('Refrigerante', 'ML', '20', 'L', '100', bebidas.id);
      suco = await insumo('Suco', 'ML', '20', 'L', '200', bebidas.id);

      produtoRefri = await novoProduto('Combo Refri');
      const produtoSuco = await novoProduto('Combo Suco');

      await recipes.create(userId, {
        productId: produtoRefri.id,
        items: [{ supplyId: refri.id, quantity: '350', unit: 'ML' }],
      });
      await recipes.create(userId, {
        productId: produtoSuco.id,
        items: [{ supplyId: suco.id, quantity: '300', unit: 'ML' }],
      });

      await vender(produtoRefri.id, 10); // 3500 ML
      await vender(produtoSuco.id, 10); // 3000 ML
      await perder(refri.id, '500', 'ML');
    }, 30000);

    it('filtra por insumo', async () => {
      const result = await report.bySupply(userId, { supplyId: refri.id });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].supplyId).toBe(refri.id);
      expect(result.filters.supplyId).toBe(refri.id);
    });

    it('filtra por categoria de insumo', async () => {
      const result = await report.bySupply(userId, {
        supplyCategoryId: bebidas.id,
      });

      expect(result.items.map((item) => item.supplyId).sort()).toEqual(
        [refri.id, suco.id].sort(),
      );
    });

    it('filtra por tipo de movimentação e avisa que o real ficou restrito', async () => {
      const result = await report.bySupply(userId, {
        supplyId: refri.id,
        movementTypes: [StockMovementType.LOSS],
      });

      // Só a perda conta como real; o estimado continua sendo a venda inteira.
      expect(result.items[0].realQuantity.toString()).toBe('500');
      expect(result.items[0].estimatedQuantity.toString()).toBe('3500');
      expect(result.interpretation.caveats.join(' ')).toContain(
        'restrito aos tipos',
      );
    });

    it('filtra por produto e avisa que perdas ficam de fora', async () => {
      const result = await report.bySupply(userId, {
        productId: produtoRefri.id,
      });

      expect(result.filters.realScope).toBe('ATTRIBUTED_TO_PRODUCTS');
      // A perda de 500 ML não tem produto, então some do real.
      expect(result.items[0].realQuantity.toString()).toBe('3500');
      expect(result.interpretation.caveats.join(' ')).toContain(
        'não têm produto identificado',
      );
    });

    it('filtra por categoria do cardápio', async () => {
      const outra = await prisma.category.create({
        data: { userId, name: `Sobremesas ${next()}`, icon: '🍰' },
      });

      const doce = await insumo('Chocolate', 'G', '5', 'KG', '150');
      const produto = await novoProduto('Brownie', '20', outra.id);

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: doce.id, quantity: '80', unit: 'G' }],
      });

      await vender(produto.id, 5);

      const result = await report.bySupply(userId, { categoryId: outra.id });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].supplyId).toBe(doce.id);
      expect(result.items[0].estimatedQuantity.toString()).toBe('400');
    });

    it('recorta pelo período informado', async () => {
      const alho = await insumo('Alho', 'G', '5', 'KG', '300');
      const produto = await novoProduto('Pizza Alho');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: alho.id, quantity: '20', unit: 'G' }],
      });

      const pedido = await vender(produto.id, 10);

      // Joga venda e movimentação para um ano atrás, mantendo os dois juntos.
      const antigo = new Date('2025-01-15T12:00:00.000Z');

      await prisma.order.update({
        where: { id: pedido.id },
        data: { paidAt: antigo },
      });
      await prisma.stockMovement.updateMany({
        where: { userId, supplyId: alho.id, type: StockMovementType.SALE },
        data: { occurredAt: antigo },
      });

      const recente = await report.bySupply(userId, { supplyId: alho.id });
      expect(recente.items).toHaveLength(0);

      const historico = await report.bySupply(userId, {
        supplyId: alho.id,
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-02-01T00:00:00.000Z',
      });

      expect(historico.items).toHaveLength(1);
      expect(historico.items[0].estimatedQuantity.toString()).toBe('200');
      expect(historico.items[0].realQuantity.toString()).toBe('200');
    });
  });

  // ---------------------------------------------------------------------------

  describe('por produto', () => {
    let presunto: { id: string };
    let produtoA: { id: string };
    let produtoB: { id: string };

    beforeAll(async () => {
      presunto = await insumo('Presunto', 'G', '20', 'KG', '600'); // R$ 0,03/g

      produtoA = await novoProduto('Pizza Presunto A');
      produtoB = await novoProduto('Pizza Presunto B');

      await recipes.create(userId, {
        productId: produtoA.id,
        items: [{ supplyId: presunto.id, quantity: '150', unit: 'G' }],
      });
      await recipes.create(userId, {
        productId: produtoB.id,
        items: [{ supplyId: presunto.id, quantity: '50', unit: 'G' }],
      });

      await vender(produtoA.id, 10); // 1500 g
      await vender(produtoB.id, 10); // 500 g
      await perder(presunto.id, '200', 'G'); // desvio sem dono
    }, 30000);

    it('separa o consumo previsto de cada prato', async () => {
      const result = await report.byProduct(userId, { supplyId: presunto.id });

      const linhaA = result.items.find((item) => item.productId === produtoA.id);
      const linhaB = result.items.find((item) => item.productId === produtoB.id);

      expect(linhaA.estimatedQuantity.toString()).toBe('1500');
      expect(linhaB.estimatedQuantity.toString()).toBe('500');
      expect(linhaA.quantitySold).toBe(10);
    });

    it('rateia o desvio sem dono na proporção do consumo previsto', async () => {
      const result = await report.byProduct(userId, { supplyId: presunto.id });

      const linhaA = result.items.find((item) => item.productId === produtoA.id);
      const linhaB = result.items.find((item) => item.productId === produtoB.id);

      // 200 g de perda divididos 75% / 25%, que é a proporção do previsto.
      expect(linhaA.attribution.realAttributed.toString()).toBe('1500');
      expect(linhaA.attribution.allocatedDeviation.toString()).toBe('150');
      expect(linhaB.attribution.allocatedDeviation.toString()).toBe('50');
    });

    it('o rateio conserva o total do relatório por insumo', async () => {
      const porProduto = await report.byProduct(userId, {
        supplyId: presunto.id,
      });
      const porInsumo = await linhaDoInsumo(presunto.id);

      const soma = porProduto.items.reduce(
        (total, item) => total.add(item.realQuantity),
        new Prisma.Decimal(0),
      );

      expect(soma.toString()).toBe(porInsumo.realQuantity.toString());
      expect(porInsumo.realQuantity.toString()).toBe('2200');
    });

    it('valoriza a diferença de cada prato pelo custo atual', async () => {
      const result = await report.byProduct(userId, { supplyId: presunto.id });
      const linhaA = result.items.find((item) => item.productId === produtoA.id);

      // 150 g × R$ 0,03 = R$ 4,50
      expect(linhaA.differenceCost.toString()).toBe('4.5');
    });
  });

  // ---------------------------------------------------------------------------

  describe('rankings', () => {
    let leve: { id: string };
    let grave: { id: string };
    let caro: { id: string };
    let categoriaRanking: { id: string };

    beforeAll(async () => {
      await settings.update(userId, {
        stockConsumptionTolerancePercentage: '5',
      });

      // Categoria própria: os rankings cortam a lista num limite, e sem o
      // recorte o resultado dependeria de quantos insumos os outros testes
      // deixaram desviando no mesmo período.
      categoriaRanking = await prisma.supplyCategory.create({
        data: { userId, name: `Ranking ${next()}` },
      });

      // R$ 0,002/g, R$ 0,04/g e R$ 5/g.
      leve = await insumo('Sal', 'G', '10', 'KG', '20', categoriaRanking.id);
      grave = await insumo(
        'Manjericão',
        'G',
        '2',
        'KG',
        '80',
        categoriaRanking.id,
      );
      caro = await insumo(
        'Trufa',
        'G',
        '1',
        'KG',
        '5000',
        categoriaRanking.id,
      );

      const produto = await novoProduto('Pizza Ranking');

      await recipes.create(userId, {
        productId: produto.id,
        items: [
          { supplyId: leve.id, quantity: '100', unit: 'G' },
          { supplyId: grave.id, quantity: '20', unit: 'G' },
          { supplyId: caro.id, quantity: '5', unit: 'G' },
        ],
      });

      await vender(produto.id, 10);

      await perder(leve.id, '30', 'G'); // 1000 -> +3%, dentro
      await perder(grave.id, '100', 'G'); // 200 -> +50%, grave
      await perder(caro.id, '10', 'G'); // 50 -> +20%, R$ 50
    }, 30000);

    it('lista apenas o que passou da tolerância, do pior para o menos ruim', async () => {
      const result = await report.topDeviations(userId, {
        supplyCategoryId: categoriaRanking.id,
      });

      const ids = result.items.map((item) => item.supplyId);

      // Manjericão desviou +50% e trufa +20%; o sal ficou nos +3% e some.
      expect(ids).toEqual([grave.id, caro.id]);
    });

    it('ordena as perdas financeiras por dinheiro, não por porcentagem', async () => {
      const result = await report.topFinancialLosses(userId, {
        supplyCategoryId: categoriaRanking.id,
      });

      const trufa = result.items.find((item) => item.supplyId === caro.id);
      const manjericao = result.items.find((item) => item.supplyId === grave.id);

      // A trufa desviou menos em porcentagem e muito mais em reais: R$ 50
      // contra R$ 4. É a inversão que justifica os dois rankings existirem.
      expect(trufa.differenceCost.toString()).toBe('50');
      expect(manjericao.differenceCost.toString()).toBe('4');
      expect(result.items.indexOf(trufa)).toBeLessThan(
        result.items.indexOf(manjericao),
      );
    });

    it('a lista de perdas ignora consumo abaixo do previsto', async () => {
      const result = await report.topFinancialLosses(userId, {});

      expect(result.items.every((item) => item.differenceCost.gt(0))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------

  describe('desperdício por período e painel', () => {
    let mussarela: { id: string };

    beforeAll(async () => {
      mussarela = await insumo('Mussarela', 'G', '20', 'KG', '700'); // R$ 0,035/g
      const produto = await novoProduto('Pizza Mussarela');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: mussarela.id, quantity: '200', unit: 'G' }],
      });

      await vender(produto.id, 10); // 2000 g, R$ 70
      await perder(mussarela.id, '400', 'G'); // R$ 14
    }, 30000);

    it('agrupa por dia, com o custo separado por tipo de movimentação', async () => {
      const result = await report.wasteByPeriod(userId, {
        supplyId: mussarela.id,
        groupBy: PeriodGrouping.DAY,
      });

      expect(result.items).toHaveLength(1);

      const hoje = result.items[0];

      expect(hoje.estimatedCost.toString()).toBe('70');
      expect(hoje.realCost.toString()).toBe('84');
      expect(hoje.differenceCost.toString()).toBe('14');
      expect(hoje.wastePercent.toString()).toBe('20');
      expect(hoje.costByMovementType[StockMovementType.LOSS].toString()).toBe(
        '14',
      );
    });

    it('agrupa por mês sem perder o total', async () => {
      const result = await report.wasteByPeriod(userId, {
        supplyId: mussarela.id,
        groupBy: PeriodGrouping.MONTH,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].bucket).toMatch(/^\d{4}-\d{2}$/);
      expect(result.items[0].differenceCost.toString()).toBe('14');
    });

    it('o painel resume estimado, real, desvio e percentual', async () => {
      const painel = await report.dashboard(userId, { supplyId: mussarela.id });

      expect(painel.estimatedConsumptionCost.toString()).toBe('70');
      expect(painel.realConsumptionCost.toString()).toBe('84');
      expect(painel.totalDeviationCost.toString()).toBe('14');
      expect(painel.wastePercent.toString()).toBe('20');
      expect(painel.counts.aboveExpected).toBe(1);
    });

    it('o painel separa desvio bruto de desvio líquido', async () => {
      // Sobra num insumo e falta em outro somam zero no líquido, mas são dois
      // problemas para apurar — o bruto é o que não deixa isso passar.
      const sobra = await insumo('Fermento', 'G', '5', 'KG', '100'); // R$ 0,02/g
      const produto = await novoProduto('Pizza Fermento');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: sobra.id, quantity: '100', unit: 'G' }],
      });

      await vender(produto.id, 10); // estimado 1000 g

      const saldo = await prisma.supply.findUnique({
        where: { id: sobra.id },
        select: { currentStock: true },
      });

      // Inventário devolveu 700 g: consumo real 300 g, R$ 14 abaixo do previsto.
      await stock.registerAdjustment(userId, {
        supplyId: sobra.id,
        targetQuantity: new Prisma.Decimal(saldo.currentStock)
          .add(700)
          .toString(),
        unit: 'G',
        reason: 'Inventário',
      } as never);

      const painel = await report.dashboard(userId, {
        supplyCategoryId: undefined,
        supplyId: undefined,
      });

      expect(painel.deviationCost.gross.gt(painel.totalDeviationCost)).toBe(
        true,
      );
      expect(painel.deviationCost.belowExpected.lt(0)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------

  describe('leitura do relatório', () => {
    it('toda resposta traz as causas possíveis do desvio', async () => {
      const result = await report.bySupply(userId, {});

      const codigos = result.interpretation.possibleCauses.map(
        (cause) => cause.code,
      );

      expect(codigos).toEqual(
        expect.arrayContaining([
          'DESPERDICIO',
          'ERRO_DE_LANCAMENTO',
          'INVENTARIO',
          'PRODUCAO',
          'PERDAS',
          'AJUSTES',
          'CONSUMO_NAO_REGISTRADO',
        ]),
      );
      expect(result.interpretation.warning).toContain(
        'não é automaticamente desperdício',
      );
    });

    it('nenhum relatório escreve no estoque', async () => {
      const antes = await prisma.stockMovement.count({ where: { userId } });

      await report.bySupply(userId, {});
      await report.byProduct(userId, {});
      await report.topDeviations(userId, {});
      await report.topFinancialLosses(userId, {});
      await report.wasteByPeriod(userId, {});
      await report.dashboard(userId, {});

      expect(await prisma.stockMovement.count({ where: { userId } })).toBe(
        antes,
      );
    });
  });
});
