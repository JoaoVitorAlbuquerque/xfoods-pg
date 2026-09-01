import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { validate } from 'class-validator';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { MeasurementUnitsModule } from 'src/modules/measurement-units/measurement-units.module';
import { StockModule } from 'src/modules/stock/stock.module';
import { SuppliesModule } from 'src/modules/supplies/supplies.module';
import { SuppliesService } from 'src/modules/supplies/services/supplies.service';
import { StockService } from './services/stock.service';
import { StockSettingsService } from './services/stock-settings.service';
import { StockCountsService } from './services/stock-counts.service';
import {
  InsufficientStockException,
  StockMovementsService,
} from './services/stock-movements.service';
import { StockStatus } from './services/stock-level.service';
import {
  CreateStockExitDto,
  CreateStockLossDto,
} from './dto/stock-operation.dto';

/**
 * Integração de verdade: sobe o grafo de injeção e usa o Postgres local.
 * Precisa do banco de pé e das migrações aplicadas.
 *
 * Todo dado é criado sob um usuário próprio e apagado no final, para não
 * encostar nos dados de desenvolvimento que já existem na base.
 */
describe('Estoque (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let supplies: SuppliesService;
  let stock: StockService;
  let settings: StockSettingsService;
  let counts: StockCountsService;
  let userId: string;

  const TEST_EMAIL = 'stock-integration@xfoods.test';

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

    // Ordem explícita: `stock_movements.supply_id` é RESTRICT, então os
    // movimentos precisam sair antes dos insumos.
    await prisma.stockCountItem.deleteMany({
      where: { stockCount: { userId: user.id } },
    });
    await prisma.stockCount.deleteMany({ where: { userId: user.id } });
    await prisma.stockMovement.deleteMany({ where: { userId: user.id } });
    await prisma.supply.deleteMany({ where: { userId: user.id } });
    await prisma.supplyCategory.deleteMany({ where: { userId: user.id } });
    await prisma.stockSettings.deleteMany({ where: { userId: user.id } });
    await prisma.measurementUnit.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        MeasurementUnitsModule,
        StockModule,
        SuppliesModule,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    supplies = moduleRef.get(SuppliesService);
    stock = moduleRef.get(StockService);
    settings = moduleRef.get(StockSettingsService);
    counts = moduleRef.get(StockCountsService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Estoque',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;
  }, 30000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  /** Confere que o cache de saldo não divergiu do livro-razão. */
  const assertReconciled = async (supplyId: string) => {
    const supply = await prisma.supply.findUnique({ where: { id: supplyId } });
    const aggregate = await prisma.stockMovement.aggregate({
      where: { supplyId },
      _sum: { quantityBase: true },
    });

    const ledger = new Prisma.Decimal(aggregate._sum.quantityBase ?? 0);

    expect(new Prisma.Decimal(supply.currentStock).toString()).toBe(
      ledger.toString(),
    );
  };

  const novoInsumo = (name: string, baseUnit = 'G', minStock = '0') =>
    supplies.create(userId, { name, baseUnit, minStock });

  describe('criação de insumo', () => {
    it('cadastra com unidade base e saldo zerado', async () => {
      const queijo = await novoInsumo('Queijo mussarela');

      expect(queijo.name).toBe('Queijo mussarela');
      expect(queijo.baseUnit.code).toBe('G');
      expect(new Prisma.Decimal(queijo.currentStock).toString()).toBe('0');
      expect(queijo.stockStatus).toBe(StockStatus.ZERO);
    });

    it('recusa unidade de embalagem como base', async () => {
      // Sem fator universal, uma compra nunca viraria saldo.
      await expect(
        supplies.create(userId, { name: 'Caixa qualquer', baseUnit: 'CX' }),
      ).rejects.toThrow(/packaging units have no/);
    });

    it('recusa nome repetido', async () => {
      await novoInsumo('Presunto');
      await expect(novoInsumo('Presunto')).rejects.toThrow(ConflictException);
    });

    it('transforma saldo de abertura em movimentação, não em saldo solto', async () => {
      const massa = await supplies.create(userId, {
        name: 'Massa de pizza',
        baseUnit: 'G',
        initialStock: '5',
        initialStockUnit: 'KG',
        initialUnitCost: '12',
      });

      expect(new Prisma.Decimal(massa.currentStock).toString()).toBe('5000');

      const movimentos = await prisma.stockMovement.findMany({
        where: { supplyId: massa.id },
      });

      expect(movimentos).toHaveLength(1);
      expect(movimentos[0].type).toBe(StockMovementType.ADJUSTMENT);
      expect(movimentos[0].reason).toBe('Saldo inicial do cadastro');
      await assertReconciled(massa.id);
    });
  });

  describe('conversão para a unidade base', () => {
    it('entrada de 10 KG num insumo com base em grama vira 10.000 G', async () => {
      const queijo = await novoInsumo('Queijo prato');

      const movimento = await stock.registerEntry(userId, {
        supplyId: queijo.id,
        quantity: '10',
        unit: 'KG',
      });

      // A quantidade informada fica preservada para auditoria...
      expect(new Prisma.Decimal(movimento.quantity).toString()).toBe('10');
      // ...e o saldo vive na unidade base.
      expect(new Prisma.Decimal(movimento.quantityBase).toString()).toBe('10000');
      expect(new Prisma.Decimal(movimento.balanceAfter).toString()).toBe('10000');
      await assertReconciled(queijo.id);
    });

    it('recusa unidade de grandeza diferente da base do insumo', async () => {
      const espeto = await novoInsumo('Espeto de madeira', 'UN');

      await expect(
        stock.registerEntry(userId, {
          supplyId: espeto.id,
          quantity: '1',
          unit: 'KG',
        }),
      ).rejects.toThrow(/whose base unit is UN/);
    });
  });

  describe('entrada', () => {
    it('soma ao saldo e calcula o custo médio ponderado', async () => {
      const molho = await novoInsumo('Molho de tomate', 'ML');

      // 2 L a R$ 10/L  ->  2000 ML a R$ 0,01/ML
      await stock.registerEntry(userId, {
        supplyId: molho.id,
        quantity: '2',
        unit: 'L',
        unitCost: '10',
      });

      // 2 L a R$ 20/L  ->  média ponderada vai para R$ 0,015/ML
      await stock.registerEntry(userId, {
        supplyId: molho.id,
        quantity: '2',
        unit: 'L',
        unitCost: '20',
      });

      const atual = await prisma.supply.findUnique({ where: { id: molho.id } });

      expect(new Prisma.Decimal(atual.currentStock).toString()).toBe('4000');
      expect(new Prisma.Decimal(atual.averageCost).toString()).toBe('0.015');
      await assertReconciled(molho.id);
    });
  });

  describe('saída', () => {
    it('subtrai do saldo e valoriza pelo custo médio', async () => {
      const calabresa = await novoInsumo('Calabresa');

      await stock.registerEntry(userId, {
        supplyId: calabresa.id,
        quantity: '1',
        unit: 'KG',
        unitCost: '30',
      });

      const saida = await stock.registerExit(userId, {
        supplyId: calabresa.id,
        quantity: '250',
        type: StockMovementType.PRODUCTION,
      });

      expect(new Prisma.Decimal(saida.quantityBase).toString()).toBe('-250');
      expect(new Prisma.Decimal(saida.balanceAfter).toString()).toBe('750');
      // 250 g a R$ 0,03/g = R$ 7,50, negativo porque saiu do estoque.
      expect(new Prisma.Decimal(saida.totalCost).toString()).toBe('-7.5');
      await assertReconciled(calabresa.id);
    });

    it('recusa lançar venda pela mão — a baixa da venda é gerada pela venda', async () => {
      // O bloqueio vive no DTO: a rota de saída manual só aceita PRODUCTION,
      // RETURN e TRANSFER. Permitir SALE aqui abriria caminho para consumo em
      // dobro quando a Fase 5 passar a gerar a baixa automaticamente.
      const comSale = Object.assign(new CreateStockExitDto(), {
        supplyId: '00000000-0000-4000-8000-000000000000',
        quantity: '1',
        type: StockMovementType.SALE,
      });

      const erros = await validate(comSale);

      expect(erros.map((e) => e.property)).toContain('type');
    });
  });

  describe('perda', () => {
    it('registra com motivo e reduz o saldo', async () => {
      const carne = await novoInsumo('Carne moída');

      await stock.registerEntry(userId, {
        supplyId: carne.id,
        quantity: '2',
        unit: 'KG',
        unitCost: '40',
      });

      const perda = await stock.registerLoss(userId, {
        supplyId: carne.id,
        quantity: '300',
        reason: 'Vencimento',
      });

      expect(perda.type).toBe(StockMovementType.LOSS);
      expect(perda.reason).toBe('Vencimento');
      expect(new Prisma.Decimal(perda.balanceAfter).toString()).toBe('1700');
      // 2 kg a R$ 40/kg = R$ 0,04/g; 300 g perdidos custam R$ 12.
      expect(new Prisma.Decimal(perda.totalCost).toString()).toBe('-12');
      await assertReconciled(carne.id);
    });

    it('exige motivo — perda sem motivo não é auditável', async () => {
      // Regressão: `reason` já morou na classe base como opcional, e o
      // `@IsOptional()` herdado dispensava o campo mesmo com `@IsNotEmpty()`
      // declarado aqui. O class-validator soma os metadados da hierarquia.
      const semMotivo = Object.assign(new CreateStockLossDto(), {
        supplyId: '00000000-0000-4000-8000-000000000000',
        quantity: '10',
      });

      const erros = await validate(semMotivo);

      expect(erros.map((e) => e.property)).toContain('reason');
    });
  });

  describe('ajuste', () => {
    it('recebe o saldo correto e lança só a diferença', async () => {
      const farinha = await novoInsumo('Farinha');

      await stock.registerEntry(userId, {
        supplyId: farinha.id,
        quantity: '25',
        unit: 'KG',
      });

      // Sistema diz 25 kg, contagem encontrou 23,5 kg.
      const ajuste = await stock.registerAdjustment(userId, {
        supplyId: farinha.id,
        targetQuantity: '23.5',
        unit: 'KG',
        reason: 'Conferência de prateleira',
      });

      expect(ajuste.applied).toBe(true);
      expect(new Prisma.Decimal(ajuste.difference).toString()).toBe('-1500');
      expect(new Prisma.Decimal(ajuste.movement.balanceAfter).toString()).toBe(
        '23500',
      );
      await assertReconciled(farinha.id);
    });

    it('não gera movimento quando não há diferença', async () => {
      const sal = await novoInsumo('Sal');
      await stock.registerEntry(userId, { supplyId: sal.id, quantity: '1000' });

      const ajuste = await stock.registerAdjustment(userId, {
        supplyId: sal.id,
        targetQuantity: '1000',
        reason: 'Conferência sem divergência',
      });

      expect(ajuste.applied).toBe(false);
      expect(ajuste.movement).toBeNull();

      const total = await prisma.stockMovement.count({
        where: { supplyId: sal.id },
      });
      expect(total).toBe(1);
    });
  });

  describe('bloqueio de estoque insuficiente', () => {
    it('recusa saída maior que o saldo com allowNegativeStock desligado', async () => {
      await settings.update(userId, { allowNegativeStock: false });

      const oregano = await novoInsumo('Orégano');
      await stock.registerEntry(userId, {
        supplyId: oregano.id,
        quantity: '100',
      });

      await expect(
        stock.registerExit(userId, {
          supplyId: oregano.id,
          quantity: '150',
          type: StockMovementType.PRODUCTION,
        }),
      ).rejects.toThrow(InsufficientStockException);
    });

    it('não deixa rastro: saldo e livro-razão ficam intactos', async () => {
      await settings.update(userId, { allowNegativeStock: false });

      const azeite = await novoInsumo('Azeite', 'ML');
      await stock.registerEntry(userId, { supplyId: azeite.id, quantity: '500' });

      await expect(
        stock.registerLoss(userId, {
          supplyId: azeite.id,
          quantity: '600',
          reason: 'Derramou',
        }),
      ).rejects.toThrow(InsufficientStockException);

      const atual = await prisma.supply.findUnique({ where: { id: azeite.id } });
      expect(new Prisma.Decimal(atual.currentStock).toString()).toBe('500');

      const movimentos = await prisma.stockMovement.count({
        where: { supplyId: azeite.id },
      });
      expect(movimentos).toBe(1);
      await assertReconciled(azeite.id);
    });
  });

  describe('estoque negativo', () => {
    it('permite e sinaliza quando allowNegativeStock está ligado', async () => {
      await settings.update(userId, { allowNegativeStock: true });

      const pimenta = await novoInsumo('Pimenta');
      await stock.registerEntry(userId, { supplyId: pimenta.id, quantity: '50' });

      const saida = await stock.registerExit(userId, {
        supplyId: pimenta.id,
        quantity: '80',
        type: StockMovementType.PRODUCTION,
      });

      expect(new Prisma.Decimal(saida.balanceAfter).toString()).toBe('-30');

      const detalhe = await supplies.findOne(userId, pimenta.id);
      expect(detalhe.stockStatus).toBe(StockStatus.NEGATIVE);
      await assertReconciled(pimenta.id);

      await settings.update(userId, { allowNegativeStock: false });
    });

    it('a trava pode ser dispensada por operação, para a baixa da venda não travar o caixa', async () => {
      await settings.update(userId, { allowNegativeStock: false });

      const cebola = await novoInsumo('Cebola');
      await stock.registerEntry(userId, { supplyId: cebola.id, quantity: '100' });

      const movimentos = moduleRef.get(StockMovementsService);

      const saida = await movimentos.register(userId, {
        supplyId: cebola.id,
        type: StockMovementType.SALE,
        direction: 'OUT',
        quantity: '150',
        forceNegative: true,
      });

      expect(new Prisma.Decimal(saida.balanceAfter).toString()).toBe('-50');
      await assertReconciled(cebola.id);
    });
  });

  describe('alertas', () => {
    it('classifica abaixo do mínimo, zerado e negativo', async () => {
      const baixo = await supplies.create(userId, {
        name: 'Alerta baixo',
        baseUnit: 'G',
        minStock: '1000',
        initialStock: '500',
      });
      const zerado = await novoInsumo('Alerta zerado');

      const alertas = await stock.getOverview(userId, true);
      const ids = alertas.items.map((item) => item.id);

      expect(ids).toContain(baixo.id);
      expect(ids).toContain(zerado.id);

      expect(
        alertas.items.find((i) => i.id === baixo.id).stockStatus,
      ).toBe(StockStatus.LOW);
      expect(
        new Prisma.Decimal(
          alertas.items.find((i) => i.id === baixo.id).shortfall,
        ).toString(),
      ).toBe('500');

      // O mais grave aparece primeiro na lista.
      expect(alertas.items[0].stockStatus).not.toBe(StockStatus.OK);
    });
  });

  describe('histórico de movimentações', () => {
    it('lista em ordem cronológica inversa, com direção derivada do sinal', async () => {
      const bacon = await novoInsumo('Bacon');

      await stock.registerEntry(userId, {
        supplyId: bacon.id,
        quantity: '1',
        unit: 'KG',
        unitCost: '50',
      });
      await stock.registerExit(userId, {
        supplyId: bacon.id,
        quantity: '200',
        type: StockMovementType.PRODUCTION,
      });
      await stock.registerLoss(userId, {
        supplyId: bacon.id,
        quantity: '50',
        reason: 'Queimou',
      });

      const historico = await stock.getMovements(userId, { supplyId: bacon.id });

      expect(historico.total).toBe(3);
      expect(historico.items.map((m) => m.type)).toEqual([
        StockMovementType.LOSS,
        StockMovementType.PRODUCTION,
        StockMovementType.PURCHASE,
      ]);
      expect(historico.items.map((m) => m.direction)).toEqual([
        'OUT',
        'OUT',
        'IN',
      ]);
      expect(historico.items[0].unit.code).toBe('G');
      await assertReconciled(bacon.id);
    });

    it('filtra por tipo', async () => {
      const linguica = await novoInsumo('Linguiça');
      await stock.registerEntry(userId, { supplyId: linguica.id, quantity: '500' });
      await stock.registerLoss(userId, {
        supplyId: linguica.id,
        quantity: '100',
        reason: 'Estragou',
      });

      const somenteperdas = await stock.getMovements(userId, {
        supplyId: linguica.id,
        type: StockMovementType.LOSS,
      });

      expect(somenteperdas.total).toBe(1);
      expect(somenteperdas.items[0].type).toBe(StockMovementType.LOSS);
    });
  });

  describe('inventário', () => {
    it('aplica a contagem e gera ajuste só onde houve diferença', async () => {
      const a = await novoInsumo('Inventário A');
      const b = await novoInsumo('Inventário B');

      await stock.registerEntry(userId, { supplyId: a.id, quantity: '25', unit: 'KG' });
      await stock.registerEntry(userId, { supplyId: b.id, quantity: '10', unit: 'KG' });

      const contagem = await counts.create(userId, {
        note: 'Contagem de fechamento',
        items: [
          { supplyId: a.id, countedQuantity: '23.5', unit: 'KG' },
          { supplyId: b.id, countedQuantity: '10', unit: 'KG' },
        ],
      });

      // Enquanto está aberta, não encosta no estoque.
      const antes = await prisma.supply.findUnique({ where: { id: a.id } });
      expect(new Prisma.Decimal(antes.currentStock).toString()).toBe('25000');

      const aplicada = await counts.apply(userId, contagem.id);

      expect(aplicada.status).toBe('APPLIED');

      const itemA = aplicada.items.find((i) => i.supplyId === a.id);
      const itemB = aplicada.items.find((i) => i.supplyId === b.id);

      expect(new Prisma.Decimal(itemA.systemQuantityBase).toString()).toBe('25000');
      expect(new Prisma.Decimal(itemA.differenceBase).toString()).toBe('-1500');
      expect(itemA.movementId).not.toBeNull();

      // Sem diferença, sem movimento.
      expect(new Prisma.Decimal(itemB.differenceBase).toString()).toBe('0');
      expect(itemB.movementId).toBeNull();

      const depois = await prisma.supply.findUnique({ where: { id: a.id } });
      expect(new Prisma.Decimal(depois.currentStock).toString()).toBe('23500');

      await assertReconciled(a.id);
      await assertReconciled(b.id);
    });

    it('recusa aplicar duas vezes', async () => {
      const c = await novoInsumo('Inventário C');
      await stock.registerEntry(userId, { supplyId: c.id, quantity: '1000' });

      const contagem = await counts.create(userId, {
        items: [{ supplyId: c.id, countedQuantity: '900' }],
      });

      await counts.apply(userId, contagem.id);
      await expect(counts.apply(userId, contagem.id)).rejects.toThrow(
        ConflictException,
      );

      await assertReconciled(c.id);
    });
  });

  describe('isolamento entre estabelecimentos', () => {
    it('não enxerga insumo de outro usuário', async () => {
      const outro = await prisma.user.findFirst({
        where: { email: { not: TEST_EMAIL } },
        select: { id: true },
      });

      if (!outro) return;

      const meu = await novoInsumo('Isolamento');

      await expect(supplies.findOne(outro.id, meu.id)).rejects.toThrow(
        /not found/i,
      );
    });
  });
});
