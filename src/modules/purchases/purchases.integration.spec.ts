import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, PurchaseStatus, StockMovementType } from '@prisma/client';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { MeasurementUnitsModule } from 'src/modules/measurement-units/measurement-units.module';
import { StockModule } from 'src/modules/stock/stock.module';
import { SuppliesModule } from 'src/modules/supplies/supplies.module';
import { PurchasesModule } from './purchases.module';
import { SuppliesService } from 'src/modules/supplies/services/supplies.service';
import { StockService } from 'src/modules/stock/services/stock.service';
import { PurchasesService } from './services/purchases.service';
import { SuppliersService } from './services/suppliers.service';
import { SupplyCostsService } from './services/supply-costs.service';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, para não encostar nos dados de desenvolvimento.
 */
describe('Compras e custo dos insumos (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let suppliers: SuppliersService;
  let costs: SupplyCostsService;
  let stock: StockService;
  let userId: string;
  let supplierId: string;

  const TEST_EMAIL = 'purchases-integration@xfoods.test';

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

    await prisma.supplyCostHistory.deleteMany({ where: { userId: user.id } });
    await prisma.purchaseItem.deleteMany({
      where: { purchase: { userId: user.id } },
    });
    await prisma.purchase.deleteMany({ where: { userId: user.id } });
    await prisma.stockCountItem.deleteMany({
      where: { stockCount: { userId: user.id } },
    });
    await prisma.stockCount.deleteMany({ where: { userId: user.id } });
    await prisma.supply.updateMany({
      where: { userId: user.id },
      data: { lastSupplierId: null, lastPurchaseUnitId: null },
    });
    await prisma.stockMovement.deleteMany({ where: { userId: user.id } });
    await prisma.supply.deleteMany({ where: { userId: user.id } });
    await prisma.supplyCategory.deleteMany({ where: { userId: user.id } });
    await prisma.supplier.deleteMany({ where: { userId: user.id } });
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
        PurchasesModule,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    suppliers = moduleRef.get(SuppliersService);
    costs = moduleRef.get(SupplyCostsService);
    stock = moduleRef.get(StockService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Compras',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;

    const supplier = await suppliers.create(userId, {
      name: 'Distribuidora Central',
      document: '12.345.678/0001-90',
    });

    supplierId = supplier.id;
  }, 30000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  const novoInsumo = (name: string, baseUnit = 'G') =>
    supplies.create(userId, { name, baseUnit });

  const comprar = async (
    supplyId: string,
    item: Record<string, unknown>,
    documentNumber?: string,
  ) => {
    const purchase = await purchases.create(userId, {
      supplierId,
      documentNumber,
      items: [{ supplyId, unit: 'KG', ...item } as never],
    });

    return purchases.confirm(userId, purchase.id);
  };

  describe('compra e conversão', () => {
    it('converte para a unidade base e deriva o custo por unidade base', async () => {
      const queijo = await novoInsumo('Queijo');

      // O caso do enunciado: 10 KG por R$ 350 -> 10.000 G -> R$ 0,035/G
      const confirmada = await comprar(
        queijo.id,
        { quantity: '10', totalPrice: '350' },
        'NF-1001',
      );

      const item = confirmada.items[0];

      expect(new Prisma.Decimal(item.quantity).toString()).toBe('10');
      expect(new Prisma.Decimal(item.quantityBase).toString()).toBe('10000');
      expect(new Prisma.Decimal(item.unitPrice).toString()).toBe('35');
      expect(new Prisma.Decimal(item.totalPrice).toString()).toBe('350');
      expect(new Prisma.Decimal(item.unitCostBase).toString()).toBe('0.035');
      expect(new Prisma.Decimal(confirmada.totalAmount).toString()).toBe('350');
    });

    it('aceita preço unitário no lugar do total e calcula o resto', async () => {
      const presunto = await novoInsumo('Presunto');

      const confirmada = await comprar(presunto.id, {
        quantity: '4',
        unitPrice: '25',
      });

      const item = confirmada.items[0];
      expect(new Prisma.Decimal(item.totalPrice).toString()).toBe('100');
      expect(new Prisma.Decimal(item.unitCostBase).toString()).toBe('0.025');
    });

    it('recusa informar preço unitário e total ao mesmo tempo', async () => {
      const bacon = await novoInsumo('Bacon');

      await expect(
        purchases.create(userId, {
          items: [
            {
              supplyId: bacon.id,
              unit: 'KG',
              quantity: '1',
              unitPrice: '10',
              totalPrice: '999',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa comprar em unidade de outra grandeza', async () => {
      const espeto = await novoInsumo('Espeto', 'UN');

      await expect(
        purchases.create(userId, {
          items: [
            { supplyId: espeto.id, unit: 'KG', quantity: '1', totalPrice: '5' },
          ],
        }),
      ).rejects.toThrow(/base unit is UN/);
    });
  });

  describe('integração com o estoque', () => {
    it('rascunho não encosta no estoque; a confirmação é que dá entrada', async () => {
      const molho = await novoInsumo('Molho', 'ML');

      const rascunho = await purchases.create(userId, {
        supplierId,
        items: [
          { supplyId: molho.id, unit: 'L', quantity: '5', totalPrice: '60' },
        ],
      });

      expect(rascunho.status).toBe(PurchaseStatus.DRAFT);

      const antes = await prisma.supply.findUnique({ where: { id: molho.id } });
      expect(new Prisma.Decimal(antes.currentStock).toString()).toBe('0');
      expect(await prisma.stockMovement.count({ where: { supplyId: molho.id } })).toBe(0);

      await purchases.confirm(userId, rascunho.id);

      const depois = await prisma.supply.findUnique({ where: { id: molho.id } });
      expect(new Prisma.Decimal(depois.currentStock).toString()).toBe('5000');

      const movimentos = await prisma.stockMovement.findMany({
        where: { supplyId: molho.id },
      });
      expect(movimentos).toHaveLength(1);
      expect(movimentos[0].type).toBe(StockMovementType.PURCHASE);
      expect(movimentos[0].referenceType).toBe('PURCHASE');
      expect(movimentos[0].referenceId).toBe(rascunho.id);
      // 60 / 5000 ml = R$ 0,012/ml
      expect(new Prisma.Decimal(movimentos[0].unitCost).toString()).toBe('0.012');
      expect(new Prisma.Decimal(movimentos[0].totalCost).toString()).toBe('60');
    });

    it('amarra o item da compra à movimentação gerada', async () => {
      const cebola = await novoInsumo('Cebola');
      const confirmada = await comprar(cebola.id, {
        quantity: '2',
        totalPrice: '10',
      });

      expect(confirmada.items[0].movementId).not.toBeNull();

      const movimento = await prisma.stockMovement.findUnique({
        where: { id: confirmada.items[0].movementId },
      });
      expect(movimento.supplyId).toBe(cebola.id);
    });

    it('recusa confirmar duas vezes', async () => {
      const alho = await novoInsumo('Alho');
      const rascunho = await purchases.create(userId, {
        items: [
          { supplyId: alho.id, unit: 'KG', quantity: '1', totalPrice: '20' },
        ],
      });

      await purchases.confirm(userId, rascunho.id);
      await expect(purchases.confirm(userId, rascunho.id)).rejects.toThrow(
        ConflictException,
      );

      // A garantia que importa: não entrou estoque duas vezes.
      const supply = await prisma.supply.findUnique({ where: { id: alho.id } });
      expect(new Prisma.Decimal(supply.currentStock).toString()).toBe('1000');
      expect(await prisma.stockMovement.count({ where: { supplyId: alho.id } })).toBe(1);
    });
  });

  describe('custo atual', () => {
    it('guarda último custo, data, fornecedor e custo por unidade base', async () => {
      const tomate = await novoInsumo('Tomate');
      const emissao = new Date('2026-08-20T12:00:00.000Z');

      const rascunho = await purchases.create(userId, {
        supplierId,
        issuedAt: emissao.toISOString(),
        items: [
          { supplyId: tomate.id, unit: 'KG', quantity: '8', totalPrice: '48' },
        ],
      });
      await purchases.confirm(userId, rascunho.id);

      const supply = await prisma.supply.findUnique({
        where: { id: tomate.id },
        include: { lastSupplier: true, lastPurchaseUnit: true },
      });

      expect(new Prisma.Decimal(supply.lastCost).toString()).toBe('0.006');
      expect(supply.lastPurchaseAt.toISOString()).toBe(emissao.toISOString());
      expect(supply.lastSupplier.name).toBe('Distribuidora Central');
      expect(new Prisma.Decimal(supply.lastPurchaseUnitPrice).toString()).toBe('6');
      expect(supply.lastPurchaseUnit.code).toBe('KG');
      expect(supply.costingMethod).toBe('LAST_PURCHASE');
    });

    it('valoriza a saída pelo último custo, não pela média', async () => {
      const frango = await novoInsumo('Frango');

      // Duas compras a preços diferentes: média seria 0,02/g, último é 0,03/g.
      await comprar(frango.id, { quantity: '1', totalPrice: '10' });
      await comprar(frango.id, { quantity: '1', totalPrice: '30' });

      const supply = await prisma.supply.findUnique({ where: { id: frango.id } });
      expect(new Prisma.Decimal(supply.lastCost).toString()).toBe('0.03');
      expect(new Prisma.Decimal(supply.averageCost).toString()).toBe('0.02');

      const saida = await stock.registerExit(userId, {
        supplyId: frango.id,
        quantity: '100',
        type: StockMovementType.PRODUCTION,
      });

      // 100 g pelo último custo = R$ 3,00 (pela média seriam R$ 2,00).
      expect(new Prisma.Decimal(saida.totalCost).toString()).toBe('-3');
      expect(new Prisma.Decimal(saida.unitCost).toString()).toBe('0.03');
    });
  });

  describe('histórico e alteração de preço', () => {
    it('mantém as duas compras e não sobrescreve o histórico', async () => {
      const leite = await novoInsumo('Leite', 'ML');

      // Os mesmos números do enunciado, num insumo estocado em ML.
      await comprar(leite.id, { quantity: '10', totalPrice: '300', unit: 'L' }, 'NF-A');
      await comprar(leite.id, { quantity: '20', totalPrice: '700', unit: 'L' }, 'NF-B');

      const { history } = await costs.findHistoryBySupply(userId, leite.id);

      expect(history).toHaveLength(2);
      // Mais recente primeiro.
      expect(new Prisma.Decimal(history[0].unitPrice).toString()).toBe('35');
      expect(new Prisma.Decimal(history[1].unitPrice).toString()).toBe('30');
      expect(history[1].previousUnitCostBase).toBeNull();
      expect(history[1].variationPercent).toBeNull();
    });

    it('calcula a variação percentual do exemplo: R$ 30/kg para R$ 35/kg', async () => {
      const requeijao = await novoInsumo('Requeijão');

      await comprar(requeijao.id, { quantity: '1', unitPrice: '30' });
      await comprar(requeijao.id, { quantity: '1', unitPrice: '35' });

      const { history } = await costs.findHistoryBySupply(userId, requeijao.id);
      const ultimo = history[0];

      expect(new Prisma.Decimal(ultimo.previousUnitCostBase).toString()).toBe('0.03');
      expect(new Prisma.Decimal(ultimo.unitCostBase).toString()).toBe('0.035');
      expect(new Prisma.Decimal(ultimo.variationPercent).toFixed(2)).toBe('16.67');
    });

    it('registra queda de preço com variação negativa', async () => {
      const oleo = await novoInsumo('Óleo', 'ML');

      await comprar(oleo.id, { quantity: '1', unitPrice: '20', unit: 'L' });
      await comprar(oleo.id, { quantity: '1', unitPrice: '15', unit: 'L' });

      const { history } = await costs.findHistoryBySupply(userId, oleo.id);
      expect(new Prisma.Decimal(history[0].variationPercent).toFixed(2)).toBe('-25.00');
    });

    it('compara por unidade base mesmo quando as compras usam unidades diferentes', async () => {
      const acucar = await novoInsumo('Açúcar');

      // 1 KG por R$ 10 = R$ 0,01/g. Depois 500 G por R$ 10 = R$ 0,02/g.
      // Comparar "10 e 10" diria que nada mudou; por unidade base, dobrou.
      await comprar(acucar.id, { quantity: '1', unitPrice: '10' });

      const segunda = await purchases.create(userId, {
        items: [
          { supplyId: acucar.id, unit: 'G', quantity: '500', totalPrice: '10' },
        ],
      });
      await purchases.confirm(userId, segunda.id);

      const { history } = await costs.findHistoryBySupply(userId, acucar.id);
      expect(new Prisma.Decimal(history[0].variationPercent).toFixed(2)).toBe('100.00');
    });

    it('lista as compras de um insumo específico', async () => {
      const pimentao = await novoInsumo('Pimentão');
      await comprar(pimentao.id, { quantity: '1', totalPrice: '8' }, 'NF-P1');
      await comprar(pimentao.id, { quantity: '2', totalPrice: '18' }, 'NF-P2');

      const lista = await purchases.findAllByUserId(userId, {
        supplyId: pimentao.id,
      });

      expect(lista.total).toBe(2);
      expect(
        lista.items.map((p) => p.documentNumber).sort(),
      ).toEqual(['NF-P1', 'NF-P2']);
    });
  });

  describe('relatório de variação', () => {
    it('traz último custo, anterior, data e variação', async () => {
      const cafe = await novoInsumo('Café');
      await comprar(cafe.id, { quantity: '1', unitPrice: '40' });
      await comprar(cafe.id, { quantity: '1', unitPrice: '50' });

      const relatorio = await costs.getVariationReport(userId);
      const linha = relatorio.items.find((i) => i.supplyId === cafe.id);

      expect(new Prisma.Decimal(linha.currentUnitPrice).toString()).toBe('50');
      expect(new Prisma.Decimal(linha.previousUnitPrice).toString()).toBe('40');
      expect(linha.currentPriceUnit).toBe('KG');
      expect(new Prisma.Decimal(linha.variationPercent).toFixed(2)).toBe('25.00');
      expect(linha.direction).toBe('UP');
      expect(linha.supplier.name).toBe('Distribuidora Central');
      expect(linha.lastPurchaseAt).toBeInstanceOf(Date);
    });

    it('marca a primeira compra sem variação, em vez de inventar 0%', async () => {
      const sal = await novoInsumo('Sal grosso');
      await comprar(sal.id, { quantity: '1', unitPrice: '5' });

      const relatorio = await costs.getVariationReport(userId);
      const linha = relatorio.items.find((i) => i.supplyId === sal.id);

      expect(linha.variationPercent).toBeNull();
      expect(linha.direction).toBeNull();
      expect(linha.previousUnitPrice).toBeNull();
    });

    it('ignora insumos que nunca foram comprados', async () => {
      const nunca = await novoInsumo('Nunca comprado');

      const relatorio = await costs.getVariationReport(userId);
      expect(relatorio.items.find((i) => i.supplyId === nunca.id)).toBeUndefined();
    });
  });

  describe('rollback da transação', () => {
    it('falha no meio da confirmação não deixa nada aplicado', async () => {
      const bom = await novoInsumo('Item bom');
      const ruim = await novoInsumo('Item ruim');

      const rascunho = await purchases.create(userId, {
        supplierId,
        items: [
          { supplyId: bom.id, unit: 'KG', quantity: '1', totalPrice: '10' },
          { supplyId: ruim.id, unit: 'KG', quantity: '1', totalPrice: '20' },
        ],
      });

      // Corrompe o segundo item para forçar a falha na metade da transação:
      // uma unidade de contagem num insumo de massa não converte.
      const unidadeIncompativel = await prisma.measurementUnit.findFirst({
        where: { code: 'UN', userId: null },
      });
      const itemRuim = rascunho.items.find((i) => i.supplyId === ruim.id);
      await prisma.purchaseItem.update({
        where: { id: itemRuim.id },
        data: { unitId: unidadeIncompativel.id },
      });

      await expect(purchases.confirm(userId, rascunho.id)).rejects.toThrow();

      // Nada do primeiro item pode ter sobrado.
      const supplyBom = await prisma.supply.findUnique({ where: { id: bom.id } });
      expect(new Prisma.Decimal(supplyBom.currentStock).toString()).toBe('0');
      expect(supplyBom.lastCost).toBeNull();
      expect(supplyBom.lastPurchaseAt).toBeNull();

      expect(
        await prisma.stockMovement.count({ where: { supplyId: bom.id } }),
      ).toBe(0);
      expect(
        await prisma.supplyCostHistory.count({ where: { supplyId: bom.id } }),
      ).toBe(0);

      // E a compra volta a ser rascunho: o UPDATE de status também é revertido.
      const depois = await prisma.purchase.findUnique({
        where: { id: rascunho.id },
      });
      expect(depois.status).toBe(PurchaseStatus.DRAFT);
      expect(depois.confirmedAt).toBeNull();
    });
  });

  describe('isolamento entre estabelecimentos', () => {
    it('não confirma compra de outro usuário', async () => {
      const outro = await prisma.user.findFirst({
        where: { email: { not: TEST_EMAIL } },
        select: { id: true },
      });

      if (!outro) return;

      const meu = await novoInsumo('Isolado');
      const rascunho = await purchases.create(userId, {
        items: [
          { supplyId: meu.id, unit: 'KG', quantity: '1', totalPrice: '1' },
        ],
      });

      await expect(
        purchases.confirm(outro.id, rascunho.id),
      ).rejects.toThrow(/not found/i);
    });
  });
});
