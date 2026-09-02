import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AllocationMethod, AllocationPeriod, Prisma } from '@prisma/client';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { AuthModule } from 'src/modules/auth/auth.module';
import { MeasurementUnitsModule } from 'src/modules/measurement-units/measurement-units.module';
import { StockModule } from 'src/modules/stock/stock.module';
import { SuppliesModule } from 'src/modules/supplies/supplies.module';
import { PurchasesModule } from 'src/modules/purchases/purchases.module';
import { RecipesModule } from 'src/modules/recipes/recipes.module';
import { ExpensesModule } from 'src/modules/expenses/expenses.module';
import { SuppliesService } from 'src/modules/supplies/services/supplies.service';
import { PurchasesService } from 'src/modules/purchases/services/purchases.service';
import { RecipesService } from 'src/modules/recipes/services/recipes.service';
import { ExpensesService } from 'src/modules/expenses/services/expenses.service';
import { CostAllocationService } from 'src/modules/expenses/services/cost-allocation.service';
import { PricingModule } from './pricing.module';
import { PricingService, PriceStatus } from './services/pricing.service';
import { PricingSettingsService } from './services/pricing-settings.service';
import { UnreachablePriceException } from './services/pricing-calculator.service';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 *
 * O período é fixo e no passado para o rateio não depender do dia da rodada.
 */
describe('Formação de preço (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let pricing: PricingService;
  let settings: PricingSettingsService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let recipes: RecipesService;
  let expenses: ExpensesService;
  let allocation: CostAllocationService;
  let userId: string;
  let menuCategoryId: string;

  const TEST_EMAIL = 'pricing-integration@xfoods.test';
  const MARCO = { from: '2026-03-01', to: '2026-03-31' };

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
        ExpensesModule,
        PricingModule,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    pricing = moduleRef.get(PricingService);
    settings = moduleRef.get(PricingSettingsService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    recipes = moduleRef.get(RecipesService);
    expenses = moduleRef.get(ExpensesService);
    allocation = moduleRef.get(CostAllocationService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Preço',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;

    const category = await prisma.category.create({
      data: { userId, name: 'Pizzas', icon: '🍕' },
    });

    menuCategoryId = category.id;
  }, 30000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  // ---------------------------------------------------------------------------

  let seq = 0;
  const next = () => (seq += 1);

  const novoProduto = (name: string, price: string) =>
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

  /** Insumo com custo por unidade base conhecido. */
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

  // ---------------------------------------------------------------------------

  describe('o exemplo do enunciado', () => {
    let pizzaId: string;

    beforeAll(async () => {
      // Custo direto de R$ 4,40 (queijo) + indireto de R$ 3,00 = R$ 7,40.
      const queijo = await insumo('Queijo', 'G', '10', 'KG', '220'); // R$ 0,022/g
      const produto = await novoProduto('Pizza Enunciado', '11.90');
      pizzaId = produto.id;

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      await expenses.create(userId, {
        description: `Aluguel ${next()}`,
        amount: '6000',
        startDate: '2026-01-01',
      } as never);

      await allocation.updateSettings(userId, {
        method: AllocationMethod.PER_SOLD_UNIT,
        referencePeriod: AllocationPeriod.MONTHLY,
        estimatedSalesUnits: '2000', // R$ 6.000 / 2.000 = R$ 3,00
      });

      await settings.update(userId, {
        desiredMarginPercent: '30',
        taxPercent: '6',
        cardFeePercent: '5',
        deliveryFeePercent: '0',
        otherFeesPercent: '0',
      });
    }, 30000);

    it('monta o custo completo de R$ 7,40', async () => {
      const detalhe = await pricing.getProductPricingDetail(
        userId,
        pizzaId,
        MARCO,
      );

      expect(detalhe.cost.directCost.toString()).toBe('4.4');
      expect(detalhe.cost.indirectCost.toString()).toBe('3');
      expect(detalhe.cost.fullCost.toString()).toBe('7.4');
    });

    it('recomenda R$ 12,54', async () => {
      const detalhe = await pricing.getProductPricingDetail(
        userId,
        pizzaId,
        MARCO,
      );

      expect(detalhe.recommendedPrice.toString()).toBe('12.54');
    });

    it('compara com o preço atual de R$ 11,90 e alerta', async () => {
      const detalhe = await pricing.getProductPricingDetail(
        userId,
        pizzaId,
        MARCO,
      );

      expect(detalhe.currentPrice.toString()).toBe('11.9');
      expect(detalhe.difference.toString()).toBe('-0.64');
      expect(detalhe.status).toBe(PriceStatus.ABAIXO_DO_RECOMENDADO);
      expect(detalhe.alert).toBe('Preço abaixo do recomendado.');
    });

    it('mostra a margem que o preço atual entrega, não a desejada', async () => {
      const detalhe = await pricing.getProductPricingDetail(
        userId,
        pizzaId,
        MARCO,
      );

      // Pediu 30% e está tirando 26,81% — é este número que justifica o alerta.
      expect(detalhe.targetMarginPercent.toString()).toBe('30');
      expect(detalhe.currentMarginPercent.toString()).toBe('26.81');
    });

    it('abre a rentabilidade nos dois preços', async () => {
      const detalhe = await pricing.getProductPricingDetail(
        userId,
        pizzaId,
        MARCO,
      );

      const atual = detalhe.profitability.atCurrentPrice;
      const recomendado = detalhe.profitability.atRecommendedPrice;

      expect(atual.price.toString()).toBe('11.9');
      expect(atual.cost.toString()).toBe('7.4');
      expect(atual.taxes.toString()).toBe('0.71');
      expect(atual.fees.toString()).toBe('0.6');
      expect(atual.profit.toString()).toBe('3.19');

      expect(recomendado.price.toString()).toBe('12.54');
      expect(recomendado.profit.toString()).toBe('3.76');
      expect(Number(recomendado.profit)).toBeGreaterThan(Number(atual.profit));
    });

    it('sugere R$ 12,50, R$ 12,90 e R$ 13,00 para arredondar', async () => {
      const detalhe = await pricing.getProductPricingDetail(
        userId,
        pizzaId,
        MARCO,
      );

      const precos = detalhe.roundingSuggestions.map((item) =>
        item.price.toString(),
      );

      expect(precos).toEqual(expect.arrayContaining(['12.5', '12.9', '13']));
    });

    it('reproduz a tabela do simulador', async () => {
      const simulacao = await pricing.simulate(userId, {
        productId: pizzaId,
        ...MARCO,
      });

      expect(simulacao.cost.toString()).toBe('7.4');
      expect(
        simulacao.scenarios.map((item) => [
          item.marginPercent.toString(),
          item.price.toString(),
        ]),
      ).toEqual([
        ['30', '12.54'],
        ['35', '13.7'],
        ['40', '15.1'],
        ['45', '16.82'],
      ]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('nunca altera o preço', () => {
    it('rodar todos os relatórios deixa products.price intacto', async () => {
      const antes = await prisma.product.findMany({
        where: { userId },
        select: { id: true, price: true },
        orderBy: { id: 'asc' },
      });

      await pricing.getProductPricing(userId, MARCO);
      await pricing.simulate(userId, { cost: '10', ...MARCO });

      for (const produto of antes) {
        await pricing
          .getProductPricingDetail(userId, produto.id, MARCO)
          .catch(() => null);
      }

      const depois = await prisma.product.findMany({
        where: { userId },
        select: { id: true, price: true },
        orderBy: { id: 'asc' },
      });

      expect(depois.map((p) => p.price.toString())).toEqual(
        antes.map((p) => p.price.toString()),
      );
    });

    it('a resposta diz que nada foi alterado', async () => {
      const resultado = await pricing.getProductPricing(userId, MARCO);

      expect(resultado.notes.join(' ')).toContain('Nenhum preço foi alterado');
    });
  });

  // ---------------------------------------------------------------------------

  describe('configuração', () => {
    it('devolve padrões sem registro gravado', async () => {
      const semConfig = await prisma.user.create({
        data: {
          name: 'Sem preço',
          email: `sem-preco-${next()}@xfoods.test`,
          password: 'x',
        },
      });

      const padrao = await settings.get(semConfig.id);

      expect(padrao.desiredMarginPercent.toString()).toBe('30');
      // Imposto e taxa nascem zerados: adivinhar o regime de alguém sairia
      // como preço recomendado sem nada avisar.
      expect(padrao.taxPercent.toString()).toBe('0');
      expect(padrao.cardFeePercent.toString()).toBe('0');
      expect(padrao.configured).toBe(false);

      await prisma.user.delete({ where: { id: semConfig.id } });
    });

    it('marca como configurado depois do primeiro salvamento', async () => {
      const atual = await settings.get(userId);

      expect(atual.configured).toBe(true);
      expect(atual.updatedAt).not.toBeNull();
    });

    it('a consulta sobrescreve a configuração sem gravar nada', async () => {
      const antes = await settings.get(userId);

      const resultado = await pricing.getProductPricing(userId, {
        ...MARCO,
        marginPercent: '50',
      });

      expect(resultado.percentages.marginPercent.toString()).toBe('50');
      expect(resultado.percentages.source.marginPercent).toBe('QUERY');
      expect(resultado.percentages.source.taxPercent).toBe('SETTINGS');

      const depois = await settings.get(userId);
      expect(depois.desiredMarginPercent.toString()).toBe(
        antes.desiredMarginPercent.toString(),
      );
    });

    it('permite precificar um canal sem taxa de cartão', async () => {
      const comCartao = await pricing.getProductPricing(userId, MARCO);
      const balcao = await pricing.getProductPricing(userId, {
        ...MARCO,
        cardFeePercent: '0',
        deliveryFeePercent: '0',
      });

      expect(Number(balcao.items[0].recommendedPrice)).toBeLessThan(
        Number(comCartao.items[0].recommendedPrice),
      );
    });

    it('soma cartão e delivery, precificando o canal mais caro', async () => {
      const resultado = await pricing.getProductPricing(userId, {
        ...MARCO,
        cardFeePercent: '5',
        deliveryFeePercent: '12',
      });

      expect(resultado.percentages.feesPercent.toString()).toBe('17');
    });
  });

  // ---------------------------------------------------------------------------

  describe('segurança da fórmula', () => {
    it('recusa quando impostos + taxas + margem chegam a 100%', async () => {
      await expect(
        pricing.getProductPricing(userId, { ...MARCO, marginPercent: '89' }),
      ).rejects.toThrow(UnreachablePriceException);
    });

    it('a mensagem explica que não é possível calcular o preço', async () => {
      await expect(
        pricing.getProductPricing(userId, { ...MARCO, marginPercent: '95' }),
      ).rejects.toThrow(/Não é possível calcular o preço/);
    });

    it('recusa percentual negativo', async () => {
      await expect(
        pricing.getProductPricing(userId, { ...MARCO, taxPercent: '-5' }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * Uma margem inviável não pode derrubar a simulação inteira: a graça do
     * simulador é justamente mostrar onde a combinação deixa de fechar.
     */
    it('no simulador, a linha inviável volta sem preço e com o motivo', async () => {
      const simulacao = await pricing.simulate(userId, {
        cost: '7.40',
        margins: ['30', '50', '95'],
        ...MARCO,
      });

      const viaveis = simulacao.scenarios.filter((item) => item.viable);
      const inviavel = simulacao.scenarios.find((item) => !item.viable);

      expect(viaveis).toHaveLength(2);
      expect(inviavel.marginPercent.toString()).toBe('95');
      expect(inviavel.price).toBeNull();
      expect(inviavel.reason).toContain('Não é possível calcular o preço');
    });
  });

  // ---------------------------------------------------------------------------

  describe('situação do preço', () => {
    it('acusa preço abaixo do custo com alerta mais grave', async () => {
      const queijo = await insumo('Queijo caro', 'G', '1', 'KG', '400');
      const produto = await novoProduto('Pizza no prejuízo', '5.00');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const detalhe = await pricing.getProductPricingDetail(
        userId,
        produto.id,
        MARCO,
      );

      expect(detalhe.status).toBe(PriceStatus.ABAIXO_DO_CUSTO);
      expect(detalhe.alert).toContain('prejuízo');
      expect(detalhe.profitability.atCurrentPrice.profit.isNegative()).toBe(
        true,
      );
    });

    it('reconhece preço acima do recomendado', async () => {
      const queijo = await insumo('Queijo barato', 'G', '10', 'KG', '50');
      const produto = await novoProduto('Pizza cara', '90.00');

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      const detalhe = await pricing.getProductPricingDetail(
        userId,
        produto.id,
        MARCO,
      );

      expect(detalhe.status).toBe(PriceStatus.ACIMA_DO_RECOMENDADO);
      expect(detalhe.alert).toBeNull();
      expect(Number(detalhe.difference)).toBeGreaterThan(0);
    });

    it('resume quantos pratos estão abaixo do recomendado', async () => {
      const resultado = await pricing.getProductPricing(userId, MARCO);

      expect(resultado.summary.products).toBeGreaterThan(0);
      expect(resultado.summary.belowCost).toBeGreaterThanOrEqual(1);
      expect(resultado.summary.belowRecommended).toBeGreaterThanOrEqual(1);
      expect(Number(resultado.summary.gapPerUnit)).toBeGreaterThan(0);
    });

    it('recusa produto sem ficha ativa, explicando o motivo', async () => {
      const semFicha = await novoProduto('Refrigerante', '8.00');

      await expect(
        pricing.getProductPricingDetail(userId, semFicha.id, MARCO),
      ).rejects.toThrow(NotFoundException);

      const lista = await pricing.getProductPricing(userId, MARCO);
      expect(
        lista.summary.productsWithoutRecipe.map((item) => item.id),
      ).toContain(semFicha.id);
    });
  });

  // ---------------------------------------------------------------------------

  describe('o custo indireto entra no preço', () => {
    it('mudar a estimativa de vendas move o preço recomendado', async () => {
      const antes = await pricing.getProductPricing(userId, MARCO);
      const precoAntes = antes.items[0].recommendedPrice;

      // Metade das vendas estimadas dobra o indireto por unidade.
      await allocation.updateSettings(userId, { estimatedSalesUnits: '1000' });

      const depois = await pricing.getProductPricing(userId, MARCO);
      const precoDepois = depois.items[0].recommendedPrice;

      expect(Number(precoDepois)).toBeGreaterThan(Number(precoAntes));

      await allocation.updateSettings(userId, { estimatedSalesUnits: '2000' });
    });

    it('herda os avisos do rateio', async () => {
      await allocation.updateSettings(userId, { estimatedSalesUnits: '0' });

      const resultado = await pricing.getProductPricing(userId, MARCO);

      expect(resultado.caveats.join(' ')).toContain('Vendas estimadas');

      await allocation.updateSettings(userId, { estimatedSalesUnits: '2000' });
    });

    it('simula um custo avulso, sem produto', async () => {
      const simulacao = await pricing.simulate(userId, {
        cost: '7.40',
        margins: ['30'],
        ...MARCO,
      });

      expect(simulacao.product).toBeNull();
      expect(simulacao.cost.toString()).toBe('7.4');
      expect(simulacao.scenarios[0].price.toString()).toBe('12.54');
    });

    it('exige produto ou custo no simulador', async () => {
      await expect(pricing.simulate(userId, MARCO)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
