import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { MeasurementUnitsModule } from 'src/modules/measurement-units/measurement-units.module';
import { StockModule } from 'src/modules/stock/stock.module';
import { SuppliesModule } from 'src/modules/supplies/supplies.module';
import { PurchasesModule } from 'src/modules/purchases/purchases.module';
import { RecipesModule } from './recipes.module';
import { SuppliesService } from 'src/modules/supplies/services/supplies.service';
import { PurchasesService } from 'src/modules/purchases/services/purchases.service';
import { RecipesService } from './services/recipes.service';

/**
 * Integração com o Postgres local. Cria o próprio usuário e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 */
describe('Ficha técnica (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let supplies: SuppliesService;
  let purchases: PurchasesService;
  let recipes: RecipesService;
  let userId: string;
  let categoryId: string;

  const TEST_EMAIL = 'recipes-integration@xfoods.test';

  const cleanUp = async () => {
    const user = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
      select: { id: true },
    });

    if (!user) return;

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
        MeasurementUnitsModule,
        StockModule,
        SuppliesModule,
        PurchasesModule,
        RecipesModule,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    supplies = moduleRef.get(SuppliesService);
    purchases = moduleRef.get(PurchasesService);
    recipes = moduleRef.get(RecipesService);

    await cleanUp();

    const user = await prisma.user.create({
      data: {
        name: 'Integração Fichas',
        email: TEST_EMAIL,
        password: 'não-usada-neste-teste',
      },
    });

    userId = user.id;

    const category = await prisma.category.create({
      data: { userId, name: 'Pizzas', icon: '🍕' },
    });

    categoryId = category.id;
  }, 30000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  // ---------------------------------------------------------------------------

  let sequencia = 0;

  const novoProduto = (name: string, price = '50') =>
    prisma.product.create({
      data: {
        userId,
        categoryId,
        name,
        description: name,
        imagePath: 'x.png',
        price: new Prisma.Decimal(price),
      },
    });

  /** Cria o insumo e dá a ele um custo conhecido via compra confirmada. */
  const insumoComCusto = async (
    name: string,
    baseUnit: string,
    quantity: string,
    unit: string,
    totalPrice: string,
  ) => {
    const supply = await supplies.create(userId, {
      name: `${name} ${(sequencia += 1)}`,
      baseUnit,
    });

    const compra = await purchases.create(userId, {
      items: [{ supplyId: supply.id, unit, quantity, totalPrice }],
    });
    await purchases.confirm(userId, compra.id);

    return supply;
  };

  describe('criação', () => {
    it('monta a ficha da pizza e calcula o custo direto', async () => {
      const produto = await novoProduto('Pizza Calabresa Grande');

      // Custos escolhidos para bater com o exemplo do enunciado.
      const massa = await insumoComCusto('Massa', 'UN', '10', 'UN', '35');
      const extrato = await insumoComCusto('Extrato', 'G', '1', 'KG', '8');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');
      const presunto = await insumoComCusto('Presunto', 'G', '1', 'KG', '30');
      const calabresa = await insumoComCusto('Calabresa', 'G', '1', 'KG', '28');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [
          { supplyId: massa.id, quantity: '1', unit: 'UN' },
          { supplyId: extrato.id, quantity: '100', unit: 'G' },
          { supplyId: queijo.id, quantity: '200', unit: 'G' },
          { supplyId: presunto.id, quantity: '200', unit: 'G' },
          { supplyId: calabresa.id, quantity: '250', unit: 'G' },
        ],
      });

      const custo = await recipes.findOne(userId, ficha.id);

      expect(custo.items).toHaveLength(5);
      expect(custo.version).toBe(1);
      // A primeira versão de um prato entra ativa.
      expect(custo.active).toBe(true);

      const queijoLinha = custo.items.find((i) => i.name.startsWith('Queijo'));
      expect(new Prisma.Decimal(queijoLinha.unitCost).toString()).toBe('0.035');
      expect(new Prisma.Decimal(queijoLinha.totalCost).toString()).toBe('7');

      const calabresaLinha = custo.items.find((i) =>
        i.name.startsWith('Calabresa'),
      );
      expect(new Prisma.Decimal(calabresaLinha.unitCost).toString()).toBe('0.028');
      expect(new Prisma.Decimal(calabresaLinha.totalCost).toString()).toBe('7');

      // 3,50 + 0,80 + 7,00 + 6,00 + 7,00
      expect(new Prisma.Decimal(custo.directCost).toString()).toBe('24.3');
      expect(custo.hasMissingCost).toBe(false);
    });

    it('reutiliza o produto existente, sem entidade paralela de prato', async () => {
      const produto = await novoProduto('Pizza Marguerita');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '150', unit: 'G' }],
      });

      const carregada = await recipes.findOne(userId, ficha.id);
      expect(carregada.productId).toBe(produto.id);
      expect(carregada.product.name).toBe('Pizza Marguerita');
    });

    it('sinaliza quando um insumo nunca foi comprado', async () => {
      const produto = await novoProduto('Prato incompleto');
      const semCusto = await supplies.create(userId, {
        name: 'Insumo sem compra',
        baseUnit: 'G',
      });

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: semCusto.id, quantity: '100', unit: 'G' }],
      });

      const custo = await recipes.findOne(userId, ficha.id);

      // O custo sai zero — o que importa é a ficha não parecer barata em
      // silêncio só porque falta informação.
      expect(new Prisma.Decimal(custo.directCost).toString()).toBe('0');
      expect(custo.hasMissingCost).toBe(true);
    });
  });

  describe('conversão de unidade', () => {
    it('aceita a ficha em KG mesmo com o insumo estocado em G', async () => {
      const produto = await novoProduto('Prato em quilos');
      const carne = await insumoComCusto('Carne', 'G', '1', 'KG', '40');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: carne.id, quantity: '0.3', unit: 'KG' }],
      });

      const custo = await recipes.findOne(userId, ficha.id);

      // 0,3 KG viram 300 G; 300 × R$ 0,04 = R$ 12,00
      expect(new Prisma.Decimal(custo.items[0].quantityBase).toString()).toBe('300');
      expect(new Prisma.Decimal(custo.directCost).toString()).toBe('12');
    });

    it('recusa unidade de grandeza incompatível', async () => {
      const produto = await novoProduto('Prato incompatível');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      await expect(
        recipes.create(userId, {
          productId: produto.id,
          items: [{ supplyId: queijo.id, quantity: '1', unit: 'L' }],
        }),
      ).rejects.toThrow(/base unit is G/);
    });
  });

  describe('percentual de perda', () => {
    it('encarece o item pela quantidade bruta necessária', async () => {
      const produto = await novoProduto('Prato com perda');
      const cebola = await insumoComCusto('Cebola', 'G', '1', 'KG', '10');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: cebola.id, quantity: '100', unit: 'G', wastePercent: '20' }],
      });

      const custo = await recipes.findOne(userId, ficha.id);
      const linha = custo.items[0];

      expect(new Prisma.Decimal(linha.quantityBase).toString()).toBe('100');
      // 100 / (1 - 0,20) = 125 g brutos
      expect(new Prisma.Decimal(linha.effectiveQuantity).toString()).toBe('125');
      expect(new Prisma.Decimal(linha.totalCost).toString()).toBe('1.25');
    });

    it('recusa perda de 100% na gravação da ficha', async () => {
      const produto = await novoProduto('Prato perda total');
      const item = await insumoComCusto('Alface', 'G', '1', 'KG', '10');

      await expect(
        recipes.create(userId, {
          productId: produto.id,
          items: [
            { supplyId: item.id, quantity: '100', unit: 'G', wastePercent: '100' },
          ],
        }),
      ).rejects.toThrow(/between 0 and 100/);
    });
  });

  describe('versionamento', () => {
    it('cria versão nova sem apagar a anterior', async () => {
      const produto = await novoProduto('Pizza versionada');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const v1 = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const v2 = await recipes.newVersion(userId, v1.id, {
        items: [{ supplyId: queijo.id, quantity: '250', unit: 'G' }],
      });

      expect(v2.version).toBe(2);
      // A nova nasce inativa: criar versão não pode trocar em silêncio a ficha
      // que está valendo nas vendas.
      expect(v2.active).toBe(false);

      const original = await recipes.findOne(userId, v1.id);
      expect(original.active).toBe(true);
      expect(new Prisma.Decimal(original.items[0].quantityBase).toString()).toBe('200');
      expect(new Prisma.Decimal(original.directCost).toString()).toBe('7');

      const nova = await recipes.findOne(userId, v2.id);
      expect(new Prisma.Decimal(nova.items[0].quantityBase).toString()).toBe('250');
      expect(new Prisma.Decimal(nova.directCost).toString()).toBe('8.75');
    });

    it('duplica os itens quando a versão nova não traz lista própria', async () => {
      const produto = await novoProduto('Pizza duplicada');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const v1 = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '180', unit: 'G' }],
      });
      const v2 = await recipes.newVersion(userId, v1.id);

      const copia = await recipes.findOne(userId, v2.id);
      expect(copia.items).toHaveLength(1);
      expect(new Prisma.Decimal(copia.items[0].quantityBase).toString()).toBe('180');
    });
  });

  describe('ativação', () => {
    it('ativar uma versão desativa as outras', async () => {
      const produto = await novoProduto('Pizza troca de versão');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const v1 = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });
      const v2 = await recipes.newVersion(userId, v1.id, {
        items: [{ supplyId: queijo.id, quantity: '300', unit: 'G' }],
      });

      await recipes.activate(userId, v2.id);

      const todas = await prisma.recipe.findMany({
        where: { userId, productId: produto.id },
        orderBy: { version: 'asc' },
      });

      expect(todas.map((r) => r.active)).toEqual([false, true]);
      expect(todas.filter((r) => r.active)).toHaveLength(1);
    });

    it('nunca deixa duas versões ativas, mesmo com várias trocas', async () => {
      const produto = await novoProduto('Pizza muitas versões');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const v1 = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });
      const v2 = await recipes.newVersion(userId, v1.id);
      const v3 = await recipes.newVersion(userId, v1.id);

      await recipes.activate(userId, v2.id);
      await recipes.activate(userId, v3.id);
      await recipes.activate(userId, v1.id);

      const ativas = await prisma.recipe.count({
        where: { userId, productId: produto.id, active: true },
      });

      expect(ativas).toBe(1);
    });

    it('a ficha ativa é a que a venda vai usar', async () => {
      const produto = await novoProduto('Pizza consulta ativa');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const v1 = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });
      const v2 = await recipes.newVersion(userId, v1.id, {
        items: [{ supplyId: queijo.id, quantity: '400', unit: 'G' }],
      });
      await recipes.activate(userId, v2.id);

      const ativa = await recipes.findActiveByProduct(userId, produto.id);
      expect(ativa.version).toBe(2);
      expect(new Prisma.Decimal(ativa.directCost).toString()).toBe('14');
    });

    it('desativar deixa o prato sem ficha ativa', async () => {
      const produto = await novoProduto('Pizza desativada');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const v1 = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      await recipes.deactivate(userId, v1.id);

      await expect(
        recipes.findActiveByProduct(userId, produto.id),
      ).rejects.toThrow(/no active recipe/);

      const semFicha = await recipes.findProductsWithoutRecipe(userId);
      expect(semFicha.items.map((p) => p.id)).toContain(produto.id);
    });
  });

  describe('edição', () => {
    it('substitui a lista de itens inteira', async () => {
      const produto = await novoProduto('Pizza editada');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');
      const presunto = await insumoComCusto('Presunto', 'G', '1', 'KG', '30');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [
          { supplyId: queijo.id, quantity: '200', unit: 'G' },
          { supplyId: presunto.id, quantity: '200', unit: 'G' },
        ],
      });

      await recipes.update(userId, ficha.id, {
        items: [{ supplyId: queijo.id, quantity: '300', unit: 'G' }],
      });

      const depois = await recipes.findOne(userId, ficha.id);
      expect(depois.items).toHaveLength(1);
      expect(new Prisma.Decimal(depois.directCost).toString()).toBe('10.5');
    });

    it('mantém os itens quando a edição não traz lista', async () => {
      const produto = await novoProduto('Pizza renomeada');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      await recipes.update(userId, ficha.id, { notes: 'Só uma observação' });

      const depois = await recipes.findOne(userId, ficha.id);
      expect(depois.items).toHaveLength(1);
      expect(depois.notes).toBe('Só uma observação');
    });
  });

  describe('sub-receitas', () => {
    it('compõe o custo do prato a partir do rendimento da sub-receita', async () => {
      const tomate = await insumoComCusto('Tomate', 'G', '5', 'KG', '30');

      // 5000 g de tomate a R$ 0,006/g = R$ 30, rendendo 4000 ML de molho.
      const molho = await recipes.create(userId, {
        name: 'Molho de tomate',
        yieldQuantity: '4000',
        yieldUnit: 'ML',
        items: [{ supplyId: tomate.id, quantity: '5', unit: 'KG' }],
      });

      const custoMolho = await recipes.findOne(userId, molho.id);
      expect(new Prisma.Decimal(custoMolho.directCost).toString()).toBe('30');
      // R$ 30 / 4000 ML = R$ 0,0075/ML
      expect(new Prisma.Decimal(custoMolho.costPerYieldUnit).toString()).toBe('0.0075');

      const produto = await novoProduto('Pizza com molho');
      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ subRecipeId: molho.id, quantity: '100', unit: 'ML' }],
      });

      const custo = await recipes.findOne(userId, ficha.id);
      // 100 ML × R$ 0,0075 = R$ 0,75
      expect(new Prisma.Decimal(custo.directCost).toString()).toBe('0.75');
      expect(custo.items[0].type).toBe('SUB_RECIPE');
    });

    it('propaga a falta de custo da sub-receita para o prato', async () => {
      const semCusto = await supplies.create(userId, {
        name: 'Insumo sem preço',
        baseUnit: 'G',
      });

      const base = await recipes.create(userId, {
        name: 'Base sem custo',
        yieldQuantity: '1000',
        yieldUnit: 'G',
        items: [{ supplyId: semCusto.id, quantity: '500', unit: 'G' }],
      });

      const produto = await novoProduto('Prato com base sem custo');
      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ subRecipeId: base.id, quantity: '100', unit: 'G' }],
      });

      const custo = await recipes.findOne(userId, ficha.id);
      expect(custo.hasMissingCost).toBe(true);
    });

    it('exige unidade de rendimento na sub-receita', async () => {
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      await expect(
        recipes.create(userId, {
          name: 'Sub sem rendimento',
          items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
        }),
      ).rejects.toThrow(/needs a yield unit/);
    });
  });

  describe('validações', () => {
    it('recusa quantidade zero', async () => {
      const produto = await novoProduto('Prato quantidade zero');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      await expect(
        recipes.create(userId, {
          productId: produto.id,
          items: [{ supplyId: queijo.id, quantity: '0', unit: 'G' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa insumo inexistente', async () => {
      const produto = await novoProduto('Prato insumo fantasma');

      await expect(
        recipes.create(userId, {
          productId: produto.id,
          items: [
            {
              supplyId: '00000000-0000-4000-8000-000000000000',
              quantity: '1',
              unit: 'G',
            },
          ],
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('recusa item sem insumo e sem sub-receita', async () => {
      const produto = await novoProduto('Prato item vazio');

      await expect(
        recipes.create(userId, {
          productId: produto.id,
          items: [{ quantity: '1', unit: 'G' }],
        }),
      ).rejects.toThrow(/exactly one of supplyId or subRecipeId/);
    });

    it('recusa insumo de outro estabelecimento', async () => {
      const outro = await prisma.user.findFirst({
        where: { email: { not: TEST_EMAIL } },
        select: { id: true },
      });

      if (!outro) return;

      const produto = await novoProduto('Prato insumo alheio');
      const meu = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      await expect(
        recipes.create(outro.id, {
          items: [{ supplyId: meu.id, quantity: '1', unit: 'G' }],
          name: 'Tentativa',
          yieldQuantity: '1',
          yieldUnit: 'G',
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('recusa o produto usando a si próprio como ingrediente', async () => {
      const produto = await novoProduto('Pizza recursiva');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        yieldQuantity: '1',
        yieldUnit: 'UN',
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      // Tentar criar outra versão do mesmo prato que consome a versão anterior.
      await expect(
        recipes.create(userId, {
          productId: produto.id,
          items: [{ subRecipeId: ficha.id, quantity: '1', unit: 'UN' }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('reporta a auto-referência mesmo quando falta unidade de rendimento', async () => {
      // Regressão: a checagem de unidade vinha primeiro e mascarava o ciclo,
      // devolvendo "sem unidade de rendimento" para um caso de auto-referência.
      const produto = await novoProduto('Pizza recursiva sem rendimento');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      expect(ficha.yieldUnitId).toBeNull();

      await expect(
        recipes.create(userId, {
          productId: produto.id,
          items: [{ subRecipeId: ficha.id, quantity: '1', unit: 'UN' }],
        }),
      ).rejects.toThrow(/cannot use itself as an ingredient/);
    });

    it('recusa ciclo indireto entre sub-receitas', async () => {
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const a = await recipes.create(userId, {
        name: 'Base A',
        yieldQuantity: '1000',
        yieldUnit: 'G',
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      const b = await recipes.create(userId, {
        name: 'Base B',
        yieldQuantity: '1000',
        yieldUnit: 'G',
        items: [{ subRecipeId: a.id, quantity: '100', unit: 'G' }],
      });

      // Fechar o ciclo: A passaria a usar B, que já usa A.
      await expect(
        recipes.update(userId, a.id, {
          items: [{ subRecipeId: b.id, quantity: '100', unit: 'G' }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('recusa ativar ficha sem itens', async () => {
      const produto = await novoProduto('Pizza vazia');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });

      await prisma.recipeItem.deleteMany({ where: { recipeId: ficha.id } });

      await expect(recipes.activate(userId, ficha.id)).rejects.toThrow(
        /empty recipe cannot be activated/,
      );
    });
  });

  describe('preservação do histórico', () => {
    it('mudar o custo do insumo não altera versões antigas, mas altera o custo atual', async () => {
      const produto = await novoProduto('Pizza histórico');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '30');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });

      const antes = await recipes.findOne(userId, ficha.id);
      expect(new Prisma.Decimal(antes.directCost).toString()).toBe('6');

      // Nova compra mais cara: o custo atual do insumo sobe.
      const compra = await purchases.create(userId, {
        items: [
          { supplyId: queijo.id, unit: 'KG', quantity: '1', totalPrice: '40' },
        ],
      });
      await purchases.confirm(userId, compra.id);

      const depois = await recipes.findOne(userId, ficha.id);
      // A ficha não mudou; o custo dela acompanha o insumo, que é o esperado
      // para uma estimativa. O congelamento por venda é o snapshot em
      // ProductOrder, preenchido na baixa.
      expect(new Prisma.Decimal(depois.directCost).toString()).toBe('8');
      expect(new Prisma.Decimal(depois.items[0].quantityBase).toString()).toBe('200');
    });

    it('as versões antigas continuam existindo e consultáveis', async () => {
      const produto = await novoProduto('Pizza arquivo');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const v1 = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '100', unit: 'G' }],
      });
      const v2 = await recipes.newVersion(userId, v1.id, {
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });
      await recipes.activate(userId, v2.id);
      const v3 = await recipes.newVersion(userId, v2.id);
      await recipes.activate(userId, v3.id);

      const versoes = await recipes.findAllByUserId(userId, {
        productId: produto.id,
      });

      expect(versoes.map((r) => r.version).sort()).toEqual([1, 2, 3]);

      // A versão 1 continua legível com o conteúdo original.
      const original = await recipes.findOne(userId, v1.id);
      expect(new Prisma.Decimal(original.items[0].quantityBase).toString()).toBe('100');
    });
  });

  describe('snapshot para a venda', () => {
    it('o item de venda tem onde congelar a ficha e o custo', async () => {
      // A Fase 5 é quem preenche; aqui o que se verifica é que os campos
      // existem, aceitam a ficha e nascem nulos.
      const produto = await novoProduto('Pizza snapshot');
      const queijo = await insumoComCusto('Queijo', 'G', '1', 'KG', '35');

      const ficha = await recipes.create(userId, {
        productId: produto.id,
        items: [{ supplyId: queijo.id, quantity: '200', unit: 'G' }],
      });
      const custo = await recipes.findOne(userId, ficha.id);

      const pedido = await prisma.order.create({
        data: {
          userId,
          table: 1,
          products: {
            create: {
              userId,
              productId: produto.id,
              quantity: 2,
              unitPrice: new Prisma.Decimal('50'),
              totalPrice: new Prisma.Decimal('100'),
            },
          },
        },
        include: { products: true },
      });

      const item = pedido.products[0];
      expect(item.recipeId).toBeNull();
      expect(item.recipeUnitCost).toBeNull();

      const congelado = await prisma.productOrder.update({
        where: { id: item.id },
        data: {
          recipeId: ficha.id,
          recipeUnitCost: custo.directCost,
          recipeTotalCost: new Prisma.Decimal(custo.directCost).mul(item.quantity),
        },
      });

      expect(congelado.recipeId).toBe(ficha.id);
      expect(new Prisma.Decimal(congelado.recipeUnitCost).toString()).toBe('7');
      expect(new Prisma.Decimal(congelado.recipeTotalCost).toString()).toBe('14');
    });
  });

  describe('relatórios', () => {
    it('lista o custo direto dos pratos com ficha ativa', async () => {
      const relatorio = await recipes.getCostReport(userId);

      expect(relatorio.items.length).toBeGreaterThan(0);
      expect(relatorio.items.every((i) => i.productId !== null)).toBe(true);
      expect(relatorio.summary.total).toBe(relatorio.items.length);
    });

    it('mede a cobertura de fichas do cardápio', async () => {
      const semFicha = await recipes.findProductsWithoutRecipe(userId);

      expect(semFicha.summary.totalProducts).toBeGreaterThan(0);
      expect(Number(semFicha.summary.coveragePercent)).toBeGreaterThanOrEqual(0);
      expect(Number(semFicha.summary.coveragePercent)).toBeLessThanOrEqual(100);
    });
  });
});
