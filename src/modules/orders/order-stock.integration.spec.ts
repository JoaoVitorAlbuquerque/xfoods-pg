import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, SizeType, StockMovementType } from '@prisma/client';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { AuthModule } from 'src/modules/auth/auth.module';
import { MeasurementUnitsModule } from 'src/modules/measurement-units/measurement-units.module';
import { StockModule } from 'src/modules/stock/stock.module';
import { SuppliesModule } from 'src/modules/supplies/supplies.module';
import { PurchasesModule } from 'src/modules/purchases/purchases.module';
import { RecipesModule } from 'src/modules/recipes/recipes.module';
import { OrdersModule } from './orders.module';
import { SuppliesService } from 'src/modules/supplies/services/supplies.service';
import { PurchasesService } from 'src/modules/purchases/services/purchases.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { StockSettingsService } from 'src/modules/stock/services/stock-settings.service';
import { InsufficientStockException } from 'src/modules/stock/services/stock-movements.service';
import { OrdersService } from './orders.service';
import { SaleWithoutRecipeException } from './services/order-stock.service';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 */
describe('Venda e baixa automática de estoque (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let recipes: RecipesService;
  let orders: OrdersService;
  let settings: StockSettingsService;
  let userId: string;
  let categoryId: string;

  const TEST_EMAIL = 'sale-stock-integration@xfoods.test';

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

    // Estornos apontam para consumos: os filhos saem antes dos pais.
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
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    recipes = moduleRef.get(RecipesService);
    orders = moduleRef.get(OrdersService);
    settings = moduleRef.get(StockSettingsService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Venda',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;

    const category = await prisma.category.create({
      data: { userId, name: 'Pizzas', icon: '🍕' },
    });

    categoryId = category.id;

    // Estado padrão dos testes: não deixa estoque negativo e permite vender
    // prato sem ficha. Cada bloco que precisa de outro ajuste faz o seu.
    await settings.update(userId, {
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

  const novoProduto = (name: string, price = '50') =>
    prisma.product.create({
      data: {
        userId,
        categoryId,
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

  const saldo = async (supplyId: string) => {
    const supply = await prisma.supply.findUnique({ where: { id: supplyId } });
    return new Prisma.Decimal(supply.currentStock);
  };

  const criarPedido = async (
    itens: { productId: string; quantity: number; size?: SizeType }[],
    table = 10,
  ) =>
    orders.create(userId, {
      table,
      description: null,
      leadId: undefined,
      status: undefined,
      paid: undefined,
      orderIds: undefined,
      products: itens.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        size: item.size ?? SizeType.MEAN,
      })),
    } as never);

  const pagar = (orderId: string, table = 10) =>
    orders.updateOrderPaid(userId, {
      orderIds: [orderId],
      paid: true,
      table,
    } as never);

  const estornarPagamento = (orderId: string, table = 10) =>
    orders.updateOrderPaid(userId, {
      orderIds: [orderId],
      paid: false,
      table,
    } as never);

  // ---------------------------------------------------------------------------

  describe('venda simples', () => {
    it('consome os insumos da ficha e congela o custo no item vendido', async () => {
      const produto = await novoProduto('Pizza Calabresa');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175'); // R$ 0,035/g

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);

      // Enquanto não paga, nada sai do estoque.
      expect((await saldo(queijo.id)).toString()).toBe(antes.toString());

      const resultado = await pagar(pedido.id);

      expect(resultado.updated).toBe(1);
      expect(resultado.stockMovements).toBe(1);
      expect(resultado.alerts).toHaveLength(0);
      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(200).toString(),
      );

      const item = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });
      expect(item.recipeId).not.toBeNull();
      expect(new Prisma.Decimal(item.recipeUnitCost).toString()).toBe('7');
      expect(new Prisma.Decimal(item.recipeTotalCost).toString()).toBe('7');
    });

    it('a movimentação sai como SALE e aponta para o item vendido', async () => {
      const produto = await novoProduto('Pizza rastreada');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      await pagar(pedido.id);

      const item = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });
      const movimento = await prisma.stockMovement.findFirst({
        where: { referenceType: 'ORDER_ITEM', referenceId: item.id },
      });

      expect(movimento.type).toBe(StockMovementType.SALE);
      expect(new Prisma.Decimal(movimento.quantityBase).toString()).toBe('-100');
      expect(new Prisma.Decimal(movimento.unitCost).toString()).toBe('0.035');
      expect(new Prisma.Decimal(movimento.totalCost).toString()).toBe('-3.5');
    });
  });

  describe('o exemplo do enunciado', () => {
    it('10 pizzas grandes consomem 10× a ficha', async () => {
      const produto = await novoProduto('Pizza Calabresa Grande');

      const massa = await insumo('Massa', 'UN', '100', 'UN', '350');
      const extrato = await insumo('Extrato', 'G', '10', 'KG', '80');
      const queijo = await insumo('Queijo', 'G', '10', 'KG', '350');
      const presunto = await insumo('Presunto', 'G', '10', 'KG', '300');
      const calabresa = await insumo('Calabresa', 'G', '10', 'KG', '280');

      await recipes.create(userId, {
        productId: produto.id,
        items: [
          { supplyId: massa.id, quantity: '1', unit: 'UN' },
          { supplyId: extrato.id, quantity: '100', unit: 'G' },
          { supplyId: queijo.id, quantity: '200', unit: 'G' },
          { supplyId: presunto.id, quantity: '200', unit: 'G' },
          { supplyId: calabresa.id, quantity: '250', unit: 'G' },
        ],
        sizeFactors: [{ size: SizeType.LARGE, factor: '1' }],
      });

      const antes = {
        massa: await saldo(massa.id),
        extrato: await saldo(extrato.id),
        queijo: await saldo(queijo.id),
        presunto: await saldo(presunto.id),
        calabresa: await saldo(calabresa.id),
      };

      const pedido = await criarPedido([
        { productId: produto.id, quantity: 10, size: SizeType.LARGE },
      ]);
      await pagar(pedido.id);

      expect((await saldo(massa.id)).toString()).toBe(
        antes.massa.sub(10).toString(),
      );
      expect((await saldo(extrato.id)).toString()).toBe(
        antes.extrato.sub(1000).toString(),
      );
      expect((await saldo(queijo.id)).toString()).toBe(
        antes.queijo.sub(2000).toString(),
      );
      expect((await saldo(presunto.id)).toString()).toBe(
        antes.presunto.sub(2000).toString(),
      );
      expect((await saldo(calabresa.id)).toString()).toBe(
        antes.calabresa.sub(2500).toString(),
      );
    });
  });

  describe('multiplicador por tamanho', () => {
    it('broto consome metade e gigante consome uma vez e meia', async () => {
      const produto = await novoProduto('Pizza com tamanhos');
      const queijo = await insumo('Queijo', 'G', '20', 'KG', '700');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
        sizeFactors: [
          { size: SizeType.TINY, factor: '0.5' },
          { size: SizeType.MEAN, factor: '1' },
          { size: SizeType.EXTRA_LARGE, factor: '1.5' },
        ],
      });

      const antes = await saldo(queijo.id);

      const pedido = await criarPedido([
        { productId: produto.id, quantity: 1, size: SizeType.TINY },
      ]);
      await pagar(pedido.id);
      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(100).toString(),
      );

      const gigante = await criarPedido([
        { productId: produto.id, quantity: 1, size: SizeType.EXTRA_LARGE },
      ]);
      await pagar(gigante.id);
      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(100).sub(300).toString(),
      );
    });

    it('tamanho sem fator cadastrado vale 1', async () => {
      const produto = await novoProduto('Pizza sem fator');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '150', unit: 'G' }],
        sizeFactors: [{ size: SizeType.TINY, factor: '0.5' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([
        { productId: produto.id, quantity: 1, size: SizeType.LARGE },
      ]);
      await pagar(pedido.id);

      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(150).toString(),
      );
    });
  });

  describe('múltiplos produtos e unidades', () => {
    it('baixa todos os itens do pedido, somando insumo compartilhado', async () => {
      const pizzaA = await novoProduto('Pizza A');
      const pizzaB = await novoProduto('Pizza B');
      const queijo = await insumo('Queijo', 'G', '20', 'KG', '700');
      const presunto = await insumo('Presunto', 'G', '10', 'KG', '300');

      await recipes.create(userId, {
        productId: pizzaA.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });
      await recipes.create(userId, {
        productId: pizzaB.id,
        items: [
          { supplyId: queijo.id, quantity: '100', unit: 'G' },
          { supplyId: presunto.id, quantity: '150', unit: 'G' },
        ],
      });

      const antesQueijo = await saldo(queijo.id);
      const antesPresunto = await saldo(presunto.id);

      const pedido = await criarPedido([
        { productId: pizzaA.id, quantity: 2 },
        { productId: pizzaB.id, quantity: 3 },
      ]);
      const resultado = await pagar(pedido.id);

      // Queijo: 2×200 + 3×100 = 700 g
      expect((await saldo(queijo.id)).toString()).toBe(
        antesQueijo.sub(700).toString(),
      );
      expect((await saldo(presunto.id)).toString()).toBe(
        antesPresunto.sub(450).toString(),
      );
      expect(resultado.stockMovements).toBe(3);
    });

    it('desdobra sub-receita até os insumos, porque sub-receita não é estocada', async () => {
      const tomate = await insumo('Tomate', 'G', '20', 'KG', '120');

      const molho = await recipes.create(userId, {
        name: `Molho ${next()}`,
        yieldQuantity: '4000',
        yieldUnit: 'ML',
        items: [{ supplyId: tomate.id, quantity: '4', unit: 'KG' }],
      });

      const produto = await novoProduto('Pizza com molho');
      await recipes.create(userId, {
        productId: produto.id,
        items: [{ subRecipeId: molho.id, quantity: '100', unit: 'ML' }],
      });

      const antes = await saldo(tomate.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 2 }]);
      await pagar(pedido.id);

      // 100/4000 do molho = 1/40 de 4000 g de tomate = 100 g por pizza.
      expect((await saldo(tomate.id)).toString()).toBe(
        antes.sub(200).toString(),
      );
    });
  });

  describe('idempotência', () => {
    it('repetir a mesma requisição não baixa o estoque de novo', async () => {
      const produto = await novoProduto('Pizza idempotente');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);

      const primeira = await pagar(pedido.id);
      const segunda = await pagar(pedido.id);
      const terceira = await pagar(pedido.id);

      expect(primeira.updated).toBe(1);
      expect(segunda.updated).toBe(0);
      expect(terceira.updated).toBe(0);
      expect(segunda.stockMovements).toBe(0);

      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(200).toString(),
      );

      const item = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });
      const movimentos = await prisma.stockMovement.count({
        where: { referenceType: 'ORDER_ITEM', referenceId: item.id },
      });
      expect(movimentos).toBe(1);
    });
  });

  describe('estoque insuficiente', () => {
    it('com a trava ligada, falta de insumo impede fechar a conta', async () => {
      await settings.update(userId, { allowNegativeStock: false });

      const produto = await novoProduto('Pizza sem insumo');
      const queijo = await insumo('Queijo', 'G', '100', 'G', '5');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '500', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);

      await expect(pagar(pedido.id)).rejects.toThrow(
        InsufficientStockException,
      );
    });

    it('e o pagamento volta atrás junto — a transação inteira é revertida', async () => {
      await settings.update(userId, { allowNegativeStock: false });

      const produto = await novoProduto('Pizza rollback');
      const queijo = await insumo('Queijo', 'G', '100', 'G', '5');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '500', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      await expect(pagar(pedido.id)).rejects.toThrow();

      const depois = await prisma.order.findUnique({
        where: { id: pedido.id },
      });

      expect(depois.paid).toBe(false);
      expect(depois.paidAt).toBeNull();
      expect(depois.stockAppliedAt).toBeNull();
      expect((await saldo(queijo.id)).toString()).toBe('100');
    });

    it('com a trava desligada, vende e deixa o saldo negativo', async () => {
      await settings.update(userId, { allowNegativeStock: true });

      const produto = await novoProduto('Pizza negativa');
      const queijo = await insumo('Queijo', 'G', '100', 'G', '5');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '300', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      const resultado = await pagar(pedido.id);

      expect(resultado.updated).toBe(1);
      expect((await saldo(queijo.id)).toString()).toBe('-200');

      await settings.update(userId, { allowNegativeStock: false });
    });
  });

  describe('rollback parcial', () => {
    it('um item que falha desfaz o consumo dos itens anteriores', async () => {
      await settings.update(userId, { allowNegativeStock: false });

      const bom = await novoProduto('Pizza que dá certo');
      const ruim = await novoProduto('Pizza que falta insumo');

      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');
      const trufa = await insumo('Trufa', 'G', '10', 'G', '50');

      await recipes.create(userId, {
        productId: bom.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });
      await recipes.create(userId, {
        productId: ruim.id,
        items: [{ supplyId: trufa.id, quantity: '500', unit: 'G' }],
      });

      const antesQueijo = await saldo(queijo.id);
      const pedido = await criarPedido([
        { productId: bom.id, quantity: 1 },
        { productId: ruim.id, quantity: 1 },
      ]);

      await expect(pagar(pedido.id)).rejects.toThrow(
        InsufficientStockException,
      );

      // O consumo do primeiro item não pode ter sobrado.
      expect((await saldo(queijo.id)).toString()).toBe(antesQueijo.toString());
      expect(
        await prisma.stockMovement.count({
          where: { userId, supplyId: queijo.id, type: StockMovementType.SALE },
        }),
      ).toBe(0);
    });
  });

  describe('produto sem ficha', () => {
    it('com allowSaleWithoutRecipe ligado, vende, avisa e não consome', async () => {
      await settings.update(userId, { allowSaleWithoutRecipe: true });

      const produto = await novoProduto('Pizza sem ficha');
      const pedido = await criarPedido([{ productId: produto.id, quantity: 3 }]);

      const resultado = await pagar(pedido.id);

      expect(resultado.updated).toBe(1);
      expect(resultado.stockMovements).toBe(0);
      expect(resultado.alerts).toHaveLength(1);
      expect(resultado.alerts[0].type).toBe('NO_RECIPE');
      expect(resultado.alerts[0].productName).toBe(produto.name);

      const item = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });
      expect(item.recipeId).toBeNull();
    });

    it('com a configuração desligada, a venda não pode ser concluída', async () => {
      await settings.update(userId, { allowSaleWithoutRecipe: false });

      const produto = await novoProduto('Pizza bloqueada');
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);

      await expect(pagar(pedido.id)).rejects.toThrow(
        SaleWithoutRecipeException,
      );

      const depois = await prisma.order.findUnique({ where: { id: pedido.id } });
      expect(depois.paid).toBe(false);

      await settings.update(userId, { allowSaleWithoutRecipe: true });
    });

    it('avisa quando a ficha tem insumo sem custo conhecido', async () => {
      const produto = await novoProduto('Pizza custo incompleto');
      const semCusto = await supplies.create(userId, {
        name: `Sem compra ${next()}`,
        baseUnit: 'G',
        initialStock: '1000',
      });

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: semCusto.id, quantity: '100', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      const resultado = await pagar(pedido.id);

      expect(resultado.alerts.map((a) => a.type)).toContain('MISSING_COST');
      // O consumo acontece mesmo assim: o que falta é o custo, não o insumo.
      expect(resultado.stockMovements).toBe(1);
    });
  });

  describe('cancelamento e estorno', () => {
    it('cancelar uma venda concluída devolve os insumos com RETURN', async () => {
      const produto = await novoProduto('Pizza cancelada');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 2 }]);
      await pagar(pedido.id);

      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(400).toString(),
      );

      const cancelado = await orders.cancel(userId, pedido.id);

      expect(cancelado.stockReversal.reversed).toBe(true);
      expect(cancelado.stockReversal.movements).toBe(1);
      expect((await saldo(queijo.id)).toString()).toBe(antes.toString());
    });

    it('o estorno é lançamento novo — o consumo original continua no extrato', async () => {
      const produto = await novoProduto('Pizza extrato');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      await pagar(pedido.id);
      await orders.cancel(userId, pedido.id);

      const item = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });
      const movimentos = await prisma.stockMovement.findMany({
        where: { referenceType: 'ORDER_ITEM', referenceId: item.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(movimentos).toHaveLength(2);
      expect(movimentos[0].type).toBe(StockMovementType.SALE);
      expect(movimentos[1].type).toBe(StockMovementType.RETURN);
      // O RETURN aponta para o SALE que desfaz.
      expect(movimentos[1].reversalOfId).toBe(movimentos[0].id);
      // O consumo original permanece intacto.
      expect(new Prisma.Decimal(movimentos[0].quantityBase).toString()).toBe(
        '-200',
      );
      // Valorizado ao mesmo custo do consumo, não ao custo de hoje.
      expect(new Prisma.Decimal(movimentos[1].unitCost).toString()).toBe(
        new Prisma.Decimal(movimentos[0].unitCost).toString(),
      );
    });

    it('cancelar duas vezes não devolve o consumo em dobro', async () => {
      const produto = await novoProduto('Pizza cancelada 2x');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      await pagar(pedido.id);

      await orders.cancel(userId, pedido.id);
      await expect(orders.cancel(userId, pedido.id)).rejects.toThrow(
        ConflictException,
      );

      expect((await saldo(queijo.id)).toString()).toBe(antes.toString());
    });

    it('cancelar pedido não pago não mexe no estoque', async () => {
      const produto = await novoProduto('Pizza não paga');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);

      const cancelado = await orders.cancel(userId, pedido.id);

      expect(cancelado.stockReversal.reversed).toBe(false);
      expect((await saldo(queijo.id)).toString()).toBe(antes.toString());
    });

    it('excluir um pedido pago também devolve o consumo', async () => {
      const produto = await novoProduto('Pizza excluída');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      await pagar(pedido.id);
      await orders.remove(userId, pedido.id);

      expect((await saldo(queijo.id)).toString()).toBe(antes.toString());
    });
  });

  describe('alteração de venda', () => {
    it('estornar o pagamento devolve o consumo, e cobrar de novo consome outra vez', async () => {
      const produto = await novoProduto('Pizza alterada');
      const queijo = await insumo('Queijo', 'G', '10', 'KG', '350');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);

      await pagar(pedido.id);
      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(200).toString(),
      );

      const estorno = await estornarPagamento(pedido.id);
      expect(estorno.stockMovements).toBe(1);
      expect((await saldo(queijo.id)).toString()).toBe(antes.toString());

      await pagar(pedido.id);
      expect((await saldo(queijo.id)).toString()).toBe(
        antes.sub(200).toString(),
      );

      const item = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });
      const movimentos = await prisma.stockMovement.findMany({
        where: { referenceType: 'ORDER_ITEM', referenceId: item.id },
        orderBy: { createdAt: 'asc' },
      });

      // SALE, RETURN, SALE — nada foi sobrescrito.
      expect(movimentos.map((m) => m.type)).toEqual([
        StockMovementType.SALE,
        StockMovementType.RETURN,
        StockMovementType.SALE,
      ]);
    });

    it('o segundo estorno devolve só o consumo novo, não o já estornado', async () => {
      const produto = await novoProduto('Pizza duplo ciclo');
      const queijo = await insumo('Queijo', 'G', '10', 'KG', '350');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await saldo(queijo.id);
      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);

      await pagar(pedido.id);
      await estornarPagamento(pedido.id);
      await pagar(pedido.id);
      const segundoEstorno = await estornarPagamento(pedido.id);

      // Só um SALE estava em aberto.
      expect(segundoEstorno.stockMovements).toBe(1);
      expect((await saldo(queijo.id)).toString()).toBe(antes.toString());
    });
  });

  describe('snapshot', () => {
    it('mudar a ficha e o preço do insumo depois não altera o custo da venda', async () => {
      const produto = await novoProduto('Pizza congelada');
      const queijo = await insumo('Queijo', 'G', '10', 'KG', '300'); // R$ 0,03/g

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 2 }]);
      await pagar(pedido.id);

      const antes = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });
      expect(new Prisma.Decimal(antes.recipeUnitCost).toString()).toBe('6');
      expect(new Prisma.Decimal(antes.recipeTotalCost).toString()).toBe('12');
      expect(antes.recipeId).toBe(ficha.id);

      // O insumo encarece...
      const compra = await purchases.create(userId, {
        items: [
          { supplyId: queijo.id, unit: 'KG', quantity: '1', totalPrice: '90' },
        ],
      });
      await purchases.confirm(userId, compra.id);

      // ...e a ficha muda.
      const v2 = await recipes.newVersion(userId, ficha.id, {
        items: [{ supplyId: queijo.id, quantity: '500', unit: 'G' }],
      });
      await recipes.activate(userId, v2.id);

      const depois = await prisma.productOrder.findFirst({
        where: { orderId: pedido.id },
      });

      expect(new Prisma.Decimal(depois.recipeUnitCost).toString()).toBe('6');
      expect(new Prisma.Decimal(depois.recipeTotalCost).toString()).toBe('12');
      expect(depois.recipeId).toBe(ficha.id);
    });

    it('o consumo do pedido fica consultável e zera após o estorno', async () => {
      const produto = await novoProduto('Pizza consulta');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      await pagar(pedido.id);

      const consumo = await orders.getConsumption(userId, pedido.id);
      expect(consumo.movements).toHaveLength(1);
      expect(
        new Prisma.Decimal(consumo.netConsumption[0].quantityBase).toString(),
      ).toBe('-200');
      expect(new Prisma.Decimal(consumo.totalRecipeCost).toString()).toBe('7');

      await orders.cancel(userId, pedido.id);

      const depois = await orders.getConsumption(userId, pedido.id);
      expect(depois.movements).toHaveLength(2);
      // Saldo líquido zerado: tudo o que saiu voltou.
      expect(
        new Prisma.Decimal(depois.netConsumption[0].quantityBase).toString(),
      ).toBe('0');
    });
  });

  describe('comportamento financeiro preservado', () => {
    it('o total e o preço congelado da venda seguem intocados pela baixa', async () => {
      const produto = await novoProduto('Pizza financeiro', '45');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 2 }]);
      await pagar(pedido.id);

      const depois = await prisma.order.findUnique({
        where: { id: pedido.id },
        include: { products: true },
      });

      expect(new Prisma.Decimal(depois.totalAmount).toString()).toBe('90');
      expect(new Prisma.Decimal(depois.products[0].unitPrice).toString()).toBe('45');
      expect(depois.paid).toBe(true);
      expect(depois.paidAt).not.toBeNull();
    });

    it('cancelar não mexe no pagamento — devolver dinheiro é decisão de caixa', async () => {
      const produto = await novoProduto('Pizza cancelada paga');
      const queijo = await insumo('Queijo', 'G', '5', 'KG', '175');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      const pedido = await criarPedido([{ productId: produto.id, quantity: 1 }]);
      await pagar(pedido.id);
      await orders.cancel(userId, pedido.id);

      const depois = await prisma.order.findUnique({ where: { id: pedido.id } });

      expect(depois.paid).toBe(true);
      expect(depois.paidAt).not.toBeNull();
      expect(depois.canceledAt).not.toBeNull();
      expect(depois.status).toBe('CANCELED');
    });
  });
});
