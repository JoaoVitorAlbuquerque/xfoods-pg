import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  AllocationMethod,
  AllocationPeriod,
  CostNature,
  ExpenseRecurrence,
  ExpenseType,
  Prisma,
  SizeType,
} from '@prisma/client';

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
import { ExpensesModule } from './expenses.module';
import { ExpensesService } from './services/expenses.service';
import { ExpenseCategoriesService } from './services/expense-categories.service';
import { CostAllocationService } from './services/cost-allocation.service';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 *
 * As janelas de competência são fixas e no passado, para o resultado não mudar
 * conforme o dia em que a suíte roda.
 */
describe('Despesas e rateio de custo (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let expenses: ExpensesService;
  let categories: ExpenseCategoriesService;
  let allocation: CostAllocationService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let recipes: RecipesService;
  let orders: OrdersService;
  let stockSettings: StockSettingsService;
  let userId: string;
  let menuCategoryId: string;

  const TEST_EMAIL = 'expenses-integration@xfoods.test';

  /** Trimestre sem vendas: isola o rateio da estimativa. */
  const MARCO = { from: '2026-03-01', to: '2026-03-31' };
  const TRIMESTRE = { from: '2026-01-01', to: '2026-03-31' };

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

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
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    expenses = moduleRef.get(ExpensesService);
    categories = moduleRef.get(ExpenseCategoriesService);
    allocation = moduleRef.get(CostAllocationService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    recipes = moduleRef.get(RecipesService);
    orders = moduleRef.get(OrdersService);
    stockSettings = moduleRef.get(StockSettingsService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Despesas',
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
      allowNegativeStock: true,
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

  const criarDespesa = (
    description: string,
    amount: string,
    overrides: Record<string, unknown> = {},
  ) =>
    expenses.create(userId, {
      description: `${description} ${next()}`,
      amount,
      startDate: '2026-01-01',
      ...overrides,
    } as never);

  /** Remove tudo que possa interferir num cenário de rateio. */
  const limparDespesas = () =>
    prisma.expense.deleteMany({ where: { userId } });

  // ---------------------------------------------------------------------------

  describe('cadastro de despesas', () => {
    it('grava os campos da despesa', async () => {
      const categoria = await categories.create(userId, {
        name: `Aluguel ${next()}`,
      });

      const despesa = await criarDespesa('Aluguel da loja', '5000', {
        expenseCategoryId: categoria.id,
        type: ExpenseType.FIXED,
        recurrence: ExpenseRecurrence.MONTHLY,
        notes: 'Contrato até 2028',
      });

      expect(despesa.amount.toString()).toBe('5000');
      expect(despesa.type).toBe(ExpenseType.FIXED);
      expect(despesa.recurrence).toBe(ExpenseRecurrence.MONTHLY);
      expect(despesa.active).toBe(true);
      expect(despesa.category.name).toBe(categoria.name);
      expect(despesa.startDate.toISOString().slice(0, 10)).toBe('2026-01-01');
    });

    /**
     * Checado no serviço, não só no DTO: um valor negativo viraria custo
     * indireto negativo e um custo por unidade negativo, sem nada acusar.
     */
    it('recusa valor zero ou negativo', async () => {
      await expect(criarDespesa('Inválida', '0')).rejects.toThrow(
        BadRequestException,
      );
      await expect(criarDespesa('Inválida', '-10')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('recusa alterar uma despesa existente para valor negativo', async () => {
      const despesa = await criarDespesa('Água', '800');

      await expect(
        expenses.update(userId, despesa.id, { amount: '-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa data final anterior à inicial', async () => {
      await expect(
        criarDespesa('Invertida', '100', {
          startDate: '2026-05-01',
          endDate: '2026-03-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa categoria de outro estabelecimento', async () => {
      const outro = await prisma.user.create({
        data: {
          name: 'Outro',
          email: `outro-${next()}@xfoods.test`,
          password: 'x',
        },
      });
      const categoriaAlheia = await prisma.expenseCategory.create({
        data: { userId: outro.id, name: 'Alheia' },
      });

      await expect(
        criarDespesa('Vazada', '100', {
          expenseCategoryId: categoriaAlheia.id,
        }),
      ).rejects.toThrow(NotFoundException);

      await prisma.expenseCategory.delete({ where: { id: categoriaAlheia.id } });
      await prisma.user.delete({ where: { id: outro.id } });
    });

    it('não deixa duas categorias com o mesmo nome', async () => {
      const nome = `Energia ${next()}`;

      await categories.create(userId, { name: nome });

      await expect(categories.create(userId, { name: nome })).rejects.toThrow(
        ConflictException,
      );
    });

    it('semeia as categorias sugeridas sem duplicar', async () => {
      const primeira = await categories.seedSuggested(userId);
      const segunda = await categories.seedSuggested(userId);

      expect(primeira.created).toBeGreaterThan(0);
      expect(segunda.created).toBe(0);
      expect(segunda.items.map((item) => item.name)).toEqual(
        expect.arrayContaining(['Aluguel', 'Energia', 'Gás', 'Internet']),
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('filtros da listagem', () => {
    it('filtra por tipo e por categoria', async () => {
      const categoria = await categories.create(userId, {
        name: `Marketing ${next()}`,
      });

      const variavel = await criarDespesa('Anúncios', '300', {
        expenseCategoryId: categoria.id,
        type: ExpenseType.VARIABLE,
      });

      const porTipo = await expenses.findAllByUserId(userId, {
        type: ExpenseType.VARIABLE,
      });
      expect(porTipo.map((item) => item.id)).toContain(variavel.id);
      expect(porTipo.every((item) => item.type === ExpenseType.VARIABLE)).toBe(
        true,
      );

      const porCategoria = await expenses.findAllByUserId(userId, {
        expenseCategoryId: categoria.id,
      });
      expect(porCategoria).toHaveLength(1);
      expect(porCategoria[0].id).toBe(variavel.id);
    });

    /**
     * Competência, não cadastro: a despesa foi criada agora, mas vigora desde
     * janeiro de 2026 e por isso aparece num filtro de março de 2026.
     */
    it('filtra por vigência, não por data de cadastro', async () => {
      const antiga = await criarDespesa('Contador', '900', {
        startDate: '2026-01-01',
        endDate: '2026-02-28',
      });

      const emJaneiro = await expenses.findAllByUserId(userId, {
        from: '2026-01-01',
        to: '2026-01-31',
      });
      expect(emJaneiro.map((item) => item.id)).toContain(antiga.id);

      const emMaio = await expenses.findAllByUserId(userId, {
        from: '2026-05-01',
        to: '2026-05-31',
      });
      expect(emMaio.map((item) => item.id)).not.toContain(antiga.id);
    });

    it('esconde despesa excluída', async () => {
      const despesa = await criarDespesa('Temporária', '50');

      await expenses.remove(userId, despesa.id);

      const lista = await expenses.findAllByUserId(userId, {});
      expect(lista.map((item) => item.id)).not.toContain(despesa.id);

      // Mas a linha continua no banco: o custo dos meses em que ela valeu
      // precisa continuar reproduzível.
      const noBanco = await prisma.expense.findUnique({
        where: { id: despesa.id },
      });
      expect(noBanco.deletedAt).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------

  describe('competência', () => {
    beforeEach(limparDespesas);

    it('repete a despesa mensal em cada mês do período', async () => {
      await criarDespesa('Aluguel', '5000', { startDate: '2026-01-01' });

      const trimestre = await expenses.getOccurrences(userId, TRIMESTRE);

      expect(trimestre.summary.occurrences).toBe(3);
      expect(trimestre.summary.total.toString()).toBe('15000');

      const marco = await expenses.getOccurrences(userId, MARCO);
      expect(marco.summary.total.toString()).toBe('5000');
    });

    it('uma despesa avulsa pesa só no mês dela', async () => {
      await criarDespesa('Conserto do forno', '1200', {
        recurrence: ExpenseRecurrence.ONCE,
        startDate: '2026-02-10',
      });

      expect(
        (await expenses.getOccurrences(userId, MARCO)).summary.total.toString(),
      ).toBe('0');
      expect(
        (
          await expenses.getOccurrences(userId, TRIMESTRE)
        ).summary.total.toString(),
      ).toBe('1200');
    });

    it('a despesa anual cai uma vez só no ano', async () => {
      await criarDespesa('Alvará', '600', {
        recurrence: ExpenseRecurrence.YEARLY,
        startDate: '2026-03-05',
      });

      expect(
        (await expenses.getOccurrences(userId, MARCO)).summary.total.toString(),
      ).toBe('600');
      expect(
        (
          await expenses.getOccurrences(userId, {
            from: '2026-04-01',
            to: '2026-12-31',
          })
        ).summary.total.toString(),
      ).toBe('0');
    });

    it('a despesa semanal soma as semanas do mês', async () => {
      // 02/03/2026 é segunda: 2, 9, 16, 23 e 30 de março.
      await criarDespesa('Feira', '400', {
        recurrence: ExpenseRecurrence.WEEKLY,
        startDate: '2026-03-02',
      });

      const marco = await expenses.getOccurrences(userId, MARCO);

      expect(marco.summary.occurrences).toBe(5);
      expect(marco.summary.total.toString()).toBe('2000');
    });

    it('não conta a despesa antes do início da vigência', async () => {
      await criarDespesa('Sistema novo', '250', { startDate: '2026-03-01' });

      expect(
        (
          await expenses.getOccurrences(userId, {
            from: '2026-01-01',
            to: '2026-02-28',
          })
        ).summary.total.toString(),
      ).toBe('0');
    });

    /**
     * O motivo de `deactivatedAt` existir. Sem o carimbo, desligar o aluguel
     * hoje zeraria o custo de janeiro no relatório de janeiro.
     */
    it('desativar não apaga as competências já passadas', async () => {
      const aluguel = await criarDespesa('Aluguel antigo', '5000', {
        startDate: '2026-01-01',
      });

      const antes = await expenses.getOccurrences(userId, TRIMESTRE);
      expect(antes.summary.total.toString()).toBe('15000');

      await expenses.setActive(userId, aluguel.id, false);

      // O carimbo é de hoje (2026-09), bem depois do trimestre: as três
      // competências de janeiro a março continuam valendo.
      const depois = await expenses.getOccurrences(userId, TRIMESTRE);
      expect(depois.summary.total.toString()).toBe('15000');

      const noBanco = await prisma.expense.findUnique({
        where: { id: aluguel.id },
      });
      expect(noBanco.deactivatedAt).not.toBeNull();
    });

    it('desativar para de gerar competência daqui pra frente', async () => {
      const despesa = await criarDespesa('Assinatura', '99', {
        startDate: '2026-01-01',
      });

      await expenses.setActive(userId, despesa.id, false);

      const futuro = await expenses.getOccurrences(userId, {
        from: '2027-01-01',
        to: '2027-12-31',
      });

      expect(futuro.summary.total.toString()).toBe('0');
    });

    it('reativar limpa a data de desativação', async () => {
      const despesa = await criarDespesa('Limpeza', '700');

      await expenses.setActive(userId, despesa.id, false);
      const reativada = await expenses.setActive(userId, despesa.id, true);

      expect(reativada.active).toBe(true);
      expect(reativada.deactivatedAt).toBeNull();
    });

    it('avisa quando alterar o valor reescreve competências passadas', async () => {
      const despesa = await criarDespesa('Energia', '2000', {
        startDate: '2026-01-01',
      });

      const atualizada = await expenses.update(userId, despesa.id, {
        amount: '2400',
      });

      expect(atualizada.warnings).toHaveLength(1);
      expect(atualizada.warnings[0]).toContain('reescrito');

      // E o aviso é literal: janeiro passou a custar o valor novo.
      const janeiro = await expenses.getOccurrences(userId, {
        from: '2026-01-01',
        to: '2026-01-31',
      });
      expect(janeiro.summary.total.toString()).toBe('2400');
    });

    it('encerrar e recadastrar preserva o histórico', async () => {
      // O caminho recomendado para um reajuste.
      const antiga = await criarDespesa('Aluguel v1', '5000', {
        startDate: '2026-01-01',
      });
      await expenses.update(userId, antiga.id, { endDate: '2026-02-28' });
      await criarDespesa('Aluguel v2', '5500', { startDate: '2026-03-01' });

      const janeiro = await expenses.getOccurrences(userId, {
        from: '2026-01-01',
        to: '2026-01-31',
      });
      const marco = await expenses.getOccurrences(userId, MARCO);

      expect(janeiro.summary.total.toString()).toBe('5000');
      expect(marco.summary.total.toString()).toBe('5500');
    });
  });

  // ---------------------------------------------------------------------------

  describe('resumo por período', () => {
    beforeEach(limparDespesas);

    it('agrupa por categoria, tipo e periodicidade', async () => {
      const fixas = await categories.create(userId, {
        name: `Ocupação ${next()}`,
      });

      await criarDespesa('Aluguel', '5000', {
        expenseCategoryId: fixas.id,
        startDate: '2026-01-01',
      });
      await criarDespesa('Energia', '2000', {
        expenseCategoryId: fixas.id,
        startDate: '2026-01-01',
      });
      await criarDespesa('Comissão', '800', {
        type: ExpenseType.VARIABLE,
        startDate: '2026-01-01',
      });

      const resumo = await expenses.getSummary(userId, MARCO);

      expect(resumo.total.toString()).toBe('7800');
      expect(resumo.byType.FIXED.toString()).toBe('7000');
      expect(resumo.byType.VARIABLE.toString()).toBe('800');
      expect(resumo.byRecurrence.MONTHLY.toString()).toBe('7800');

      const ocupacao = resumo.byCategory.find(
        (item) => item.categoryId === fixas.id,
      );
      expect(ocupacao.total.toString()).toBe('7000');
    });

    it('mostra despesa sem categoria separada', async () => {
      await criarDespesa('Avulsa', '150', { startDate: '2026-01-01' });

      const resumo = await expenses.getSummary(userId, MARCO);

      expect(
        resumo.byCategory.find((item) => item.categoryId === null).name,
      ).toBe('Sem categoria');
    });
  });

  // ---------------------------------------------------------------------------

  describe('rateio — o exemplo do enunciado', () => {
    beforeAll(async () => {
      await limparDespesas();

      await criarDespesa('Aluguel', '5000', { startDate: '2026-01-01' });
      await criarDespesa('Água', '800', { startDate: '2026-01-01' });
      await criarDespesa('Energia', '2000', { startDate: '2026-01-01' });
      await criarDespesa('Gás', '1000', { startDate: '2026-01-01' });
      await criarDespesa('Internet', '200', { startDate: '2026-01-01' });

      await allocation.updateSettings(userId, {
        method: AllocationMethod.PER_SOLD_UNIT,
        referencePeriod: AllocationPeriod.MONTHLY,
        estimatedSalesUnits: '3000',
      });
    }, 30000);

    it('soma R$ 9.000 de custo indireto no mês', async () => {
      const resultado = await allocation.getAllocation(userId, MARCO);

      expect(resultado.indirectCost.total.toString()).toBe('9000');
      expect(resultado.indirectCost.expenses).toHaveLength(5);
    });

    it('divide por 3.000 unidades e chega a R$ 3,00 por unidade', async () => {
      const resultado = await allocation.getAllocation(userId, MARCO);

      expect(resultado.divisor.estimatedSalesUnits.toString()).toBe('3000');
      expect(resultado.costPerUnit.toString()).toBe('3');
    });

    /**
     * A estimativa é POR período de referência. Sem escalar, um relatório de
     * trimestre dividiria R$ 27.000 por 3.000 e o custo por unidade triplicaria
     * só porque a janela ficou maior.
     */
    it('escala a estimativa quando a janela cobre mais de um mês', async () => {
      const resultado = await allocation.getAllocation(userId, TRIMESTRE);

      expect(resultado.indirectCost.total.toString()).toBe('27000');
      expect(resultado.divisor.referencePeriods).toBe(3);
      expect(resultado.divisor.estimatedSalesUnits.toString()).toBe('9000');
      expect(resultado.costPerUnit.toString()).toBe('3');
      expect(resultado.caveats.join(' ')).toContain('multiplicada por 3');
    });

    it('quebra o custo indireto por categoria', async () => {
      const resultado = await allocation.getAllocation(userId, MARCO);

      const total = resultado.indirectCost.byCategory.reduce(
        (sum, item) => sum.add(item.total),
        new Prisma.Decimal(0),
      );

      expect(total.toString()).toBe('9000');
    });
  });

  // ---------------------------------------------------------------------------

  describe('quais despesas entram no rateio', () => {
    beforeEach(async () => {
      await limparDespesas();
      await allocation.updateSettings(userId, {
        method: AllocationMethod.PER_SOLD_UNIT,
        referencePeriod: AllocationPeriod.MONTHLY,
        estimatedSalesUnits: '1000',
        includeFixed: true,
        includeVariable: true,
      });
    });

    it('respeita o desligamento por tipo', async () => {
      await criarDespesa('Aluguel', '3000', { type: ExpenseType.FIXED });
      await criarDespesa('Comissão', '1000', { type: ExpenseType.VARIABLE });

      expect(
        (await allocation.getAllocation(userId, MARCO)).indirectCost.total.toString(),
      ).toBe('4000');

      await allocation.updateSettings(userId, { includeVariable: false });

      expect(
        (await allocation.getAllocation(userId, MARCO)).indirectCost.total.toString(),
      ).toBe('3000');
    });

    it('respeita a exclusão de uma despesa específica', async () => {
      await criarDespesa('Aluguel', '3000');
      await criarDespesa('Reforma do salão', '9000', {
        includeInAllocation: false,
      });

      const resultado = await allocation.getAllocation(userId, MARCO);

      expect(resultado.indirectCost.total.toString()).toBe('3000');
      // Mas continua sendo despesa: aparece no resumo do período.
      expect((await expenses.getSummary(userId, MARCO)).total.toString()).toBe(
        '12000',
      );
    });

    /**
     * Custo direto já é medido pela ficha técnica. Somá-lo no rateio o
     * contaria duas vezes no custo completo.
     */
    it('deixa de fora categoria marcada como custo direto', async () => {
      const direta = await categories.create(userId, {
        name: `Embalagem ${next()}`,
        nature: CostNature.DIRECT,
      });

      await criarDespesa('Aluguel', '3000');
      await criarDespesa('Embalagens', '2000', {
        expenseCategoryId: direta.id,
      });

      expect(
        (await allocation.getAllocation(userId, MARCO)).indirectCost.total.toString(),
      ).toBe('3000');
    });
  });

  // ---------------------------------------------------------------------------

  describe('configuração de rateio', () => {
    it('devolve padrões sem registro gravado', async () => {
      const semRegistro = await prisma.user.create({
        data: {
          name: 'Sem config',
          email: `sem-config-${next()}@xfoods.test`,
          password: 'x',
        },
      });

      const settings = await allocation.getSettings(semRegistro.id);

      expect(settings.method).toBe(AllocationMethod.PER_SOLD_UNIT);
      expect(settings.referencePeriod).toBe(AllocationPeriod.MONTHLY);
      expect(settings.estimatedSalesUnits.toString()).toBe('0');
      expect(settings.updatedAt).toBeNull();

      await prisma.user.delete({ where: { id: semRegistro.id } });
    });

    it('sem estimativa não inventa custo por unidade', async () => {
      await limparDespesas();
      await criarDespesa('Aluguel', '5000');
      await allocation.updateSettings(userId, { estimatedSalesUnits: '0' });

      const resultado = await allocation.getAllocation(userId, MARCO);

      expect(resultado.indirectCost.total.toString()).toBe('5000');
      expect(resultado.costPerUnit).toBeNull();
      expect(resultado.caveats.join(' ')).toContain('Vendas estimadas não');
    });

    it('recusa os métodos ainda não implementados', async () => {
      await allocation.updateSettings(userId, {
        method: AllocationMethod.BY_REVENUE,
        estimatedSalesUnits: '1000',
      });

      await expect(allocation.getAllocation(userId, MARCO)).rejects.toThrow(
        NotImplementedException,
      );

      await allocation.updateSettings(userId, {
        method: AllocationMethod.MANUAL,
      });
      await expect(allocation.getAllocation(userId, MARCO)).rejects.toThrow(
        NotImplementedException,
      );

      await allocation.updateSettings(userId, {
        method: AllocationMethod.PER_SOLD_UNIT,
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('vendas reais confrontadas com a estimativa', () => {
    it('mede as unidades vendidas do período e mostra o outro custo por unidade', async () => {
      await limparDespesas();

      // Janela do mês corrente, que é onde as vendas do teste caem.
      const hoje = new Date();
      const mes = {
        from: new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))
          .toISOString()
          .slice(0, 10),
        to: new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0))
          .toISOString()
          .slice(0, 10),
      };

      await criarDespesa('Aluguel', '1000', { startDate: mes.from });
      await allocation.updateSettings(userId, {
        estimatedSalesUnits: '100',
        method: AllocationMethod.PER_SOLD_UNIT,
      });

      const produto = await prisma.product.create({
        data: {
          userId,
          categoryId: menuCategoryId,
          name: `Produto vendas ${next()}`,
          description: 'x',
          imagePath: 'x.png',
          price: new Prisma.Decimal('20'),
        },
      });

      const pedido = await orders.create(userId, {
        table: 12,
        description: null,
        leadId: undefined,
        status: undefined,
        paid: undefined,
        orderIds: undefined,
        products: [
          { productId: produto.id, quantity: 40, size: SizeType.MEAN },
        ],
      } as never);

      await orders.updateOrderPaid(userId, {
        orderIds: [pedido.id],
        paid: true,
        table: 12,
      } as never);

      const resultado = await allocation.getAllocation(userId, mes);

      expect(resultado.divisor.actualSalesUnits.toString()).toBe('40');
      expect(resultado.divisor.actualRevenue.toString()).toBe('800');
      // R$ 1.000 / 100 estimadas = R$ 10; pelas 40 reais, R$ 25.
      expect(resultado.costPerUnit.toString()).toBe('10');
      expect(resultado.costPerUnitByActualSales.toString()).toBe('25');
      expect(resultado.caveats.join(' ')).toContain('difere das vendas');
    }, 30000);
  });

  // ---------------------------------------------------------------------------

  describe('custo completo', () => {
    let produtoId: string;

    beforeAll(async () => {
      await limparDespesas();
      await criarDespesa('Aluguel', '6000', { startDate: '2026-01-01' });
      await allocation.updateSettings(userId, {
        method: AllocationMethod.PER_SOLD_UNIT,
        referencePeriod: AllocationPeriod.MONTHLY,
        estimatedSalesUnits: '2000',
        includeFixed: true,
        includeVariable: true,
      });

      // Queijo a R$ 0,035/g; 200 g por pizza = R$ 7,00 de custo direto.
      const queijo = await supplies.create(userId, {
        name: `Queijo ${next()}`,
        baseUnit: 'G',
      });
      const compra = await purchases.create(userId, {
        items: [
          {
            supplyId: queijo.id,
            unit: 'KG',
            quantity: '10',
            totalPrice: '350',
          },
        ],
      });
      await purchases.confirm(userId, compra.id);

      const produto = await prisma.product.create({
        data: {
          userId,
          categoryId: menuCategoryId,
          name: `Pizza Custo ${next()}`,
          description: 'x',
          imagePath: 'x.png',
          price: new Prisma.Decimal('25'),
        },
      });

      produtoId = produto.id;

      await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });
    }, 30000);

    it('soma custo direto e custo indireto rateado', async () => {
      const resultado = await allocation.getFullCost(userId, MARCO);
      const linha = resultado.items.find(
        (item) => item.productId === produtoId,
      );

      // R$ 6.000 / 2.000 = R$ 3,00 de indireto por unidade.
      expect(resultado.allocatedIndirectCostPerUnit.toString()).toBe('3');
      expect(linha.directCost.toString()).toBe('7');
      expect(linha.allocatedIndirectCost.toString()).toBe('3');
      expect(linha.fullCost.toString()).toBe('10');
    });

    it('descreve o preço que já existe sem alterá-lo', async () => {
      const antes = await prisma.product.findUnique({
        where: { id: produtoId },
        select: { price: true },
      });

      const resultado = await allocation.getFullCost(userId, MARCO);
      const linha = resultado.items.find(
        (item) => item.productId === produtoId,
      );

      expect(linha.sellingPrice.toString()).toBe('25');
      expect(linha.resultPerUnit.toString()).toBe('15');
      expect(linha.fullCostPercentOfPrice.toString()).toBe('40');

      const depois = await prisma.product.findUnique({
        where: { id: produtoId },
        select: { price: true },
      });
      expect(depois.price.toString()).toBe(antes.price.toString());
    });

    it('aponta prato cujo preço não cobre o custo completo', async () => {
      const barato = await prisma.product.create({
        data: {
          userId,
          categoryId: menuCategoryId,
          name: `Pizza Barata ${next()}`,
          description: 'x',
          imagePath: 'x.png',
          price: new Prisma.Decimal('5'),
        },
      });

      const queijo = await prisma.supply.findFirst({
        where: { userId, name: { startsWith: 'Queijo' } },
      });

      await recipes.create(userId, {
        productId: barato.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const resultado = await allocation.getFullCost(userId, MARCO);

      expect(
        resultado.summary.belowFullCost.map((item) => item.productId),
      ).toContain(barato.id);
    });

    it('avisa que nada foi somado ao preço de venda', async () => {
      const resultado = await allocation.getFullCost(userId, MARCO);

      expect(resultado.notes.join(' ')).toContain(
        'Nenhuma despesa foi somada ao preço de venda',
      );
    });

    it('lista os produtos sem ficha, cujo custo completo é desconhecido', async () => {
      const semFicha = await prisma.product.create({
        data: {
          userId,
          categoryId: menuCategoryId,
          name: `Refrigerante ${next()}`,
          description: 'x',
          imagePath: 'x.png',
          price: new Prisma.Decimal('8'),
        },
      });

      const resultado = await allocation.getFullCost(userId, MARCO);

      expect(
        resultado.summary.productsWithoutRecipe.map((item) => item.id),
      ).toContain(semFicha.id);
      expect(resultado.items.map((item) => item.productId)).not.toContain(
        semFicha.id,
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('isolamento entre estabelecimentos', () => {
    it('não enxerga despesa de outro usuário', async () => {
      const outro = await prisma.user.create({
        data: {
          name: 'Vizinho',
          email: `vizinho-${next()}@xfoods.test`,
          password: 'x',
        },
      });

      await prisma.expense.create({
        data: {
          userId: outro.id,
          description: 'Aluguel do vizinho',
          amount: new Prisma.Decimal('99999'),
          startDate: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      const resumo = await expenses.getSummary(userId, MARCO);

      expect(resumo.byCategory.every((item) => item.total.lt(99999))).toBe(true);
      expect(
        (await expenses.findAllByUserId(userId, {})).every(
          (item) => item.userId === userId,
        ),
      ).toBe(true);

      await prisma.expense.deleteMany({ where: { userId: outro.id } });
      await prisma.user.delete({ where: { id: outro.id } });
    });
  });
});
