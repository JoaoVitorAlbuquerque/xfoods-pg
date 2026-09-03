import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MeasurementUnit, Prisma, SizeType } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { UnitConversionService } from 'src/modules/measurement-units/services/unit-conversion.service';
import { SupplyCostingService } from 'src/modules/stock/services/supply-costing.service';
import { RecipeCostingService } from './recipe-costing.service';
import { CreateRecipeDto, RecipeItemDto } from '../dto/create-recipe.dto';
import { UpdateRecipeDto } from '../dto/update-recipe.dto';
import { ListRecipesDto } from '../dto/list-recipes.dto';

const RECIPE_INCLUDE = {
  product: { select: { id: true, name: true, price: true } },
  yieldUnit: { select: { id: true, code: true, name: true, kind: true } },
  outputSupply: {
    select: {
      id: true,
      name: true,
      currentStock: true,
      costingMethod: true,
      lastCost: true,
      averageCost: true,
      baseUnit: { select: { id: true, code: true, name: true, kind: true } },
    },
  },
  sizeFactors: { orderBy: { size: 'asc' } },
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      unit: { select: { id: true, code: true, name: true, kind: true } },
      supply: {
        select: {
          id: true,
          name: true,
          costingMethod: true,
          lastCost: true,
          averageCost: true,
          baseUnit: { select: { id: true, code: true, name: true, kind: true } },
        },
      },
      subRecipe: {
        select: {
          id: true,
          name: true,
          productId: true,
          version: true,
          yieldQuantity: true,
          outputSupplyId: true,
          // `factorToBase` entra porque o custo do subproduto estocado é
          // convertido entre a unidade de rendimento e a unidade base do
          // insumo de saída.
          yieldUnit: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true,
              factorToBase: true,
            },
          },
          outputSupply: {
            select: {
              id: true,
              name: true,
              costingMethod: true,
              lastCost: true,
              averageCost: true,
              baseUnit: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  kind: true,
                  factorToBase: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.RecipeInclude;

/** Profundidade máxima de aninhamento de sub-receitas. */
const MAX_DEPTH = 10;

/** Consumo de um insumo, já na unidade base dele. */
export type SupplyConsumption = {
  supplyId: string;
  supplyName: string;
  baseUnitCode: string;
  quantityBase: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  hasMissingCost: boolean;
};

@Injectable()
export class RecipesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly unitConversionService: UnitConversionService,
    private readonly supplyCostingService: SupplyCostingService,
    private readonly recipeCostingService: RecipeCostingService,
  ) {}

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  findAllByUserId(userId: string, filters: ListRecipesDto) {
    return this.prismaService.recipe.findMany({
      where: {
        userId,
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.type === 'SUB' ? { productId: null } : {}),
        ...(filters.type === 'PRODUCT' ? { NOT: { productId: null } } : {}),
        ...(filters.active === undefined
          ? {}
          : { active: filters.active === 'true' }),
      },
      include: {
        product: { select: { id: true, name: true } },
        yieldUnit: { select: { code: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ productId: 'asc' }, { version: 'desc' }],
    });
  }

  async findOne(userId: string, recipeId: string) {
    const recipe = await this.loadRecipe(userId, recipeId);

    return this.withCost(userId, recipe);
  }

  /** Ficha que vale para novas vendas deste prato. */
  async findActiveByProduct(userId: string, productId: string) {
    const recipe = await this.prismaService.recipe.findFirst({
      where: { userId, productId, active: true },
      include: RECIPE_INCLUDE,
    });

    if (!recipe) {
      throw new NotFoundException(
        'This product has no active recipe. Create one so its cost can be ' +
          'calculated and its stock consumption tracked.',
      );
    }

    return this.withCost(userId, recipe);
  }

  /**
   * Produtos vendáveis sem ficha ativa.
   *
   * Sem este relatório o estoque mente em silêncio: o prato vende, nenhum
   * insumo baixa, e o saldo na tela continua batendo enquanto some da prateleira.
   */
  async findProductsWithoutRecipe(userId: string) {
    const products = await this.prismaService.product.findMany({
      where: {
        userId,
        deleted: false,
        active: true,
        recipes: { none: { active: true } },
      },
      select: { id: true, name: true, price: true },
      orderBy: { name: 'asc' },
    });

    const total = await this.prismaService.product.count({
      where: { userId, deleted: false, active: true },
    });

    return {
      items: products,
      summary: {
        withoutRecipe: products.length,
        totalProducts: total,
        coveragePercent:
          total === 0
            ? null
            : new Prisma.Decimal(total - products.length)
                .div(total)
                .mul(100)
                .toDecimalPlaces(2),
      },
    };
  }

  /** Custo direto de todos os pratos com ficha ativa. */
  async getCostReport(userId: string) {
    const recipes = await this.prismaService.recipe.findMany({
      where: { userId, active: true, NOT: { productId: null } },
      include: RECIPE_INCLUDE,
      orderBy: { product: { name: 'asc' } },
    });

    const items = [];

    for (const recipe of recipes) {
      const cost = await this.withCost(userId, recipe);

      items.push({
        productId: recipe.productId,
        productName: recipe.product?.name,
        recipeId: recipe.id,
        version: recipe.version,
        sellingPrice: recipe.product?.price ?? null,
        directCost: cost.directCost,
        costPerYieldUnit: cost.costPerYieldUnit,
        hasMissingCost: cost.hasMissingCost,
      });
    }

    return {
      items,
      summary: {
        total: items.length,
        withMissingCost: items.filter((item) => item.hasMissingCost).length,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------------

  async create(userId: string, dto: CreateRecipeDto) {
    const isSubRecipe = !dto.productId;

    if (isSubRecipe && !dto.name?.trim()) {
      throw new BadRequestException(
        'A sub-recipe needs a name: without a product, the name is what ' +
          'identifies it.',
      );
    }

    if (dto.productId) {
      const product = await this.prismaService.product.findFirst({
        where: { id: dto.productId, userId },
        select: { id: true },
      });

      if (!product) {
        throw new NotFoundException('Product not found.');
      }
    }

    const yieldUnit = await this.resolveYieldUnit(userId, dto, isSubRecipe);

    if (dto.outputSupplyId) {
      await this.resolveOutputSupply(
        userId,
        dto.outputSupplyId,
        isSubRecipe,
        yieldUnit,
      );
    }

    const items = await this.buildItems(userId, dto.items, {
      productId: dto.productId ?? null,
      recipeId: null,
    });

    return this.prismaService.$transaction(async (tx) => {
      const version = await this.nextVersion(tx, userId, {
        productId: dto.productId ?? null,
        name: dto.name?.trim() ?? null,
      });

      // A primeira versão de um prato entra ativa; as seguintes só por pedido
      // explícito, para que criar uma versão nova não troque a ficha que está
      // valendo sem ninguém mandar.
      const shouldActivate = dto.activate ?? version === 1;

      if (shouldActivate) {
        await this.deactivateSiblings(tx, userId, {
          productId: dto.productId ?? null,
          name: dto.name?.trim() ?? null,
        });
      }

      return tx.recipe.create({
        data: {
          userId,
          productId: dto.productId ?? null,
          name: dto.name?.trim() ?? null,
          version,
          active: shouldActivate,
          yieldQuantity: new Prisma.Decimal(dto.yieldQuantity ?? 1),
          yieldUnitId: yieldUnit?.id ?? null,
          outputSupplyId: dto.outputSupplyId ?? null,
          notes: dto.notes?.trim(),
          items: { create: items },
          ...(dto.sizeFactors
            ? { sizeFactors: { create: this.buildSizeFactors(dto.sizeFactors) } }
            : {}),
        },
        include: RECIPE_INCLUDE,
      });
    });
  }

  async update(userId: string, recipeId: string, dto: UpdateRecipeDto) {
    const current = await this.loadRecipe(userId, recipeId);
    const isSubRecipe = current.productId === null;

    const yieldUnit =
      dto.yieldUnit === undefined
        ? null
        : await this.resolveYieldUnit(
            userId,
            { yieldUnit: dto.yieldUnit },
            isSubRecipe,
          );

    if (dto.outputSupplyId) {
      await this.resolveOutputSupply(
        userId,
        dto.outputSupplyId,
        isSubRecipe,
        yieldUnit ?? (current.yieldUnit as MeasurementUnit | null),
      );
    }

    const items =
      dto.items === undefined
        ? null
        : await this.buildItems(userId, dto.items, {
            productId: current.productId,
            recipeId: current.id,
          });

    return this.prismaService.$transaction(async (tx) => {
      if (items !== null) {
        // Substituição integral: uma ficha editada é a lista nova, não a união
        // dela com a antiga. O histórico fica preservado pelas outras versões.
        await tx.recipeItem.deleteMany({ where: { recipeId } });
      }

      if (dto.sizeFactors !== undefined) {
        await tx.recipeSizeFactor.deleteMany({ where: { recipeId } });
      }

      await tx.recipe.update({
        where: { id: recipeId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name?.trim() ?? null }),
          ...(dto.notes === undefined
            ? {}
            : { notes: dto.notes?.trim() ?? null }),
          ...(dto.yieldQuantity === undefined
            ? {}
            : { yieldQuantity: new Prisma.Decimal(dto.yieldQuantity) }),
          ...(yieldUnit === null ? {} : { yieldUnitId: yieldUnit.id }),
          ...(dto.outputSupplyId === undefined
            ? {}
            : { outputSupplyId: dto.outputSupplyId }),
          ...(items === null ? {} : { items: { create: items } }),
          ...(dto.sizeFactors === undefined
            ? {}
            : {
                sizeFactors: {
                  create: this.buildSizeFactors(dto.sizeFactors),
                },
              }),
        },
      });

      return tx.recipe.findUnique({
        where: { id: recipeId },
        include: RECIPE_INCLUDE,
      });
    });
  }

  /**
   * Cria uma versão nova copiando esta. A versão de origem continua intacta —
   * é isso que preserva o histórico quando a receita muda.
   */
  async newVersion(userId: string, recipeId: string, dto?: UpdateRecipeDto) {
    const source = await this.loadRecipe(userId, recipeId);

    const items =
      dto?.items === undefined
        ? source.items.map((item, index) => ({
            supplyId: item.supplyId,
            subRecipeId: item.subRecipeId,
            unitId: item.unitId,
            quantity: item.quantity,
            quantityBase: item.quantityBase,
            wastePercent: item.wastePercent,
            notes: item.notes,
            sortOrder: index,
          }))
        : await this.buildItems(userId, dto.items, {
            productId: source.productId,
            recipeId: null,
          });

    return this.prismaService.$transaction(async (tx) => {
      const version = await this.nextVersion(tx, userId, {
        productId: source.productId,
        name: source.name,
      });

      return tx.recipe.create({
        data: {
          userId,
          productId: source.productId,
          name: dto?.name?.trim() ?? source.name,
          version,
          // Nasce inativa: quem cria uma versão ainda está editando, e a ficha
          // antiga precisa continuar valendo até alguém decidir trocar.
          active: false,
          yieldQuantity:
            dto?.yieldQuantity === undefined
              ? source.yieldQuantity
              : new Prisma.Decimal(dto.yieldQuantity),
          yieldUnitId: source.yieldUnitId,
          // A versão nova produz o mesmo subproduto: trocar a receita do molho
          // não cria um molho diferente na geladeira.
          outputSupplyId: dto?.outputSupplyId ?? source.outputSupplyId,
          notes: dto?.notes?.trim() ?? source.notes,
          items: { create: items },
          sizeFactors: {
            create: (dto?.sizeFactors
              ? this.buildSizeFactors(dto.sizeFactors)
              : source.sizeFactors.map((entry) => ({
                  size: entry.size,
                  factor: entry.factor,
                }))),
          },
        },
        include: RECIPE_INCLUDE,
      });
    });
  }

  async activate(userId: string, recipeId: string) {
    const recipe = await this.loadRecipe(userId, recipeId);

    if (recipe.items.length === 0) {
      throw new BadRequestException(
        'An empty recipe cannot be activated: it would report a direct cost ' +
          'of zero for the dish.',
      );
    }

    // Desativar as irmãs e ativar esta na mesma transação é o que garante que
    // não existam duas versões ativas — nem por um instante.
    return this.prismaService.$transaction(async (tx) => {
      await this.deactivateSiblings(tx, userId, {
        productId: recipe.productId,
        name: recipe.name,
      });

      return tx.recipe.update({
        where: { id: recipeId },
        data: { active: true },
        include: RECIPE_INCLUDE,
      });
    });
  }

  async deactivate(userId: string, recipeId: string) {
    await this.loadRecipe(userId, recipeId);

    return this.prismaService.recipe.update({
      where: { id: recipeId },
      data: { active: false },
      include: RECIPE_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // Custo
  // -------------------------------------------------------------------------

  /**
   * Custo direto: soma de (quantidade bruta × custo atual do insumo).
   * O custo atual de cada insumo vem do método de custeio configurado nele.
   */
  private async withCost(
    userId: string,
    recipe: Prisma.RecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>,
    visited: Set<string> = new Set(),
    depth = 0,
  ) {
    if (depth > MAX_DEPTH) {
      throw new BadRequestException(
        `Recipe nesting is deeper than ${MAX_DEPTH} levels.`,
      );
    }

    if (visited.has(recipe.id)) {
      throw new ConflictException(
        `Recipe ${recipe.id} references itself through a sub-recipe.`,
      );
    }

    visited.add(recipe.id);

    const lines = [];
    let hasMissingCost = false;

    for (const item of recipe.items) {
      let unitCost: Prisma.Decimal;
      let label: string;
      let reference: Record<string, unknown>;

      if (item.supply) {
        unitCost = this.supplyCostingService.getCurrentUnitCost(item.supply);
        label = item.supply.name;
        reference = { type: 'SUPPLY', supplyId: item.supply.id };

        // Insumo nunca comprado tem custo zero. Sinalizar é o que impede a
        // ficha de parecer barata só porque falta informação.
        if (unitCost.lte(0)) {
          hasMissingCost = true;
        }
      } else if (item.subRecipe?.outputSupply) {
        // Subproduto estocado custa o que custou produzi-lo, que é o custo do
        // insumo de saída. Somar a receita de novo daria o custo de fazer um
        // lote HOJE — número diferente do que está na geladeira.
        const output = item.subRecipe.outputSupply;

        // O custo do insumo é por unidade base; a quantidade da ficha está em
        // unidade de rendimento. Converter 1 unidade de rendimento dá quantas
        // unidades base ela vale, e o custo acompanha.
        const baseUnitsPerYieldUnit = this.unitConversionService.convert(
          1,
          item.subRecipe.yieldUnit,
          output.baseUnit,
        );

        unitCost = this.supplyCostingService
          .getCurrentUnitCost(output)
          .mul(baseUnitsPerYieldUnit);

        label = output.name;
        reference = {
          type: 'SUB_RECIPE_STOCKED',
          subRecipeId: item.subRecipe.id,
          supplyId: output.id,
        };

        if (unitCost.lte(0)) {
          hasMissingCost = true;
        }
      } else {
        const sub = await this.loadRecipe(userId, item.subRecipeId);
        const subCost = await this.withCost(
          userId,
          sub,
          new Set(visited),
          depth + 1,
        );

        unitCost = this.recipeCostingService.costPerYieldUnit(
          subCost.directCost,
          sub.yieldQuantity,
        );
        label = sub.name ?? sub.product?.name ?? 'Sub-receita';
        reference = { type: 'SUB_RECIPE', subRecipeId: sub.id };
        hasMissingCost = hasMissingCost || subCost.hasMissingCost;
      }

      const cost = this.recipeCostingService.itemCost(
        item.quantityBase,
        item.wastePercent,
        unitCost,
      );

      lines.push({
        id: item.id,
        ...reference,
        name: label,
        quantity: item.quantity,
        unit: item.unit.code,
        quantityBase: cost.netQuantity,
        wastePercent: item.wastePercent,
        effectiveQuantity: cost.effectiveQuantity,
        unitCost: cost.unitCost,
        totalCost: cost.totalCost,
        notes: item.notes,
      });
    }

    const directCost = lines.reduce(
      (total, line) => total.add(line.totalCost),
      new Prisma.Decimal(0),
    );

    return {
      id: recipe.id,
      productId: recipe.productId,
      product: recipe.product,
      name: recipe.name,
      version: recipe.version,
      active: recipe.active,
      yieldQuantity: recipe.yieldQuantity,
      yieldUnit: recipe.yieldUnit,
      notes: recipe.notes,
      items: lines,
      directCost,
      costPerYieldUnit: this.recipeCostingService.costPerYieldUnit(
        directCost,
        recipe.yieldQuantity,
      ),
      hasMissingCost,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Desdobramento para consumo
  // -------------------------------------------------------------------------

  /**
   * Achata a ficha em consumo de insumos.
   *
   * Uma sub-receita tem dois destinos, e é `outputSupplyId` que decide:
   *
   * - SEM insumo de saída, ela não existe como saldo: o desdobramento continua
   *   até os insumos dela. Uma pizza que usa 100 ML de um molho que rende
   *   4000 ML consome 1/40 do tomate e da cebola daquele molho.
   * - COM insumo de saída, o molho é produzido e tem saldo próprio. O
   *   desdobramento PARA ali e consome o molho. Continuar descendo baixaria o
   *   tomate uma segunda vez — ele já saiu quando o lote foi produzido.
   *
   * `client` precisa ser o client da transação quando isto roda dentro de uma —
   * senão a leitura não enxerga o que a própria transação já escreveu.
   */
  async explodeToSupplies(
    userId: string,
    recipeId: string,
    multiplier: Prisma.Decimal | string | number = 1,
    client: Prisma.TransactionClient = this.prismaService,
    visited: Set<string> = new Set(),
    depth = 0,
  ): Promise<SupplyConsumption[]> {
    if (depth > MAX_DEPTH) {
      throw new BadRequestException(
        `Recipe nesting is deeper than ${MAX_DEPTH} levels.`,
      );
    }

    if (visited.has(recipeId)) {
      throw new ConflictException(
        `Recipe ${recipeId} references itself through a sub-recipe.`,
      );
    }

    visited.add(recipeId);

    const recipe = await client.recipe.findFirst({
      where: { id: recipeId, userId },
      include: {
        items: {
          include: {
            supply: {
              select: {
                id: true,
                name: true,
                costingMethod: true,
                lastCost: true,
                averageCost: true,
                baseUnit: { select: { code: true } },
              },
            },
            subRecipe: {
              select: {
                id: true,
                yieldQuantity: true,
                yieldUnit: true,
                outputSupply: {
                  select: {
                    id: true,
                    name: true,
                    costingMethod: true,
                    lastCost: true,
                    averageCost: true,
                    baseUnit: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!recipe) {
      throw new NotFoundException('Recipe not found.');
    }

    const factor = new Prisma.Decimal(multiplier);
    const collected: SupplyConsumption[] = [];

    for (const item of recipe.items) {
      const effective = this.recipeCostingService
        .effectiveQuantity(item.quantityBase, item.wastePercent)
        .mul(factor);

      if (item.supply) {
        const unitCost = this.supplyCostingService.getCurrentUnitCost(
          item.supply,
        );

        collected.push({
          supplyId: item.supply.id,
          supplyName: item.supply.name,
          baseUnitCode: item.supply.baseUnit.code,
          quantityBase: effective,
          unitCost,
          totalCost: effective.mul(unitCost),
          hasMissingCost: unitCost.lte(0),
        });

        continue;
      }

      // Subproduto estocado: consome o próprio molho, não os insumos dele.
      if (item.subRecipe.outputSupply) {
        const output = item.subRecipe.outputSupply;
        const unitCost = this.supplyCostingService.getCurrentUnitCost(output);

        // A quantidade do item está na unidade de rendimento da sub-receita;
        // o saldo vive na unidade base do insumo de saída. Sem converter, 10 KG
        // de molho virariam 10 G no estoque.
        const quantityBase = this.unitConversionService.convert(
          effective,
          item.subRecipe.yieldUnit,
          output.baseUnit,
        );

        collected.push({
          supplyId: output.id,
          supplyName: output.name,
          baseUnitCode: output.baseUnit.code,
          quantityBase,
          unitCost,
          totalCost: quantityBase.mul(unitCost),
          hasMissingCost: unitCost.lte(0),
        });

        continue;
      }

      // A quantidade do item está na unidade de rendimento da sub-receita.
      // Dividir pelo rendimento dá a fração de uma execução dela.
      const fraction = effective.div(item.subRecipe.yieldQuantity);

      collected.push(
        ...(await this.explodeToSupplies(
          userId,
          item.subRecipe.id,
          fraction,
          client,
          new Set(visited),
          depth + 1,
        )),
      );
    }

    return this.aggregate(collected);
  }

  /** Fator de consumo do tamanho vendido. Tamanho sem fator cadastrado vale 1. */
  sizeFactorFor(
    sizeFactors: { size: SizeType; factor: Prisma.Decimal }[],
    size: SizeType,
  ): Prisma.Decimal {
    const found = sizeFactors.find((entry) => entry.size === size);

    return found ? new Prisma.Decimal(found.factor) : new Prisma.Decimal(1);
  }

  /** Um mesmo insumo pode chegar por caminhos diferentes; some antes de baixar. */
  private aggregate(items: SupplyConsumption[]): SupplyConsumption[] {
    const bySupply = new Map<string, SupplyConsumption>();

    for (const item of items) {
      const existing = bySupply.get(item.supplyId);

      if (!existing) {
        bySupply.set(item.supplyId, { ...item });
        continue;
      }

      existing.quantityBase = existing.quantityBase.add(item.quantityBase);
      existing.totalCost = existing.totalCost.add(item.totalCost);
      existing.hasMissingCost = existing.hasMissingCost || item.hasMissingCost;
    }

    return [...bySupply.values()];
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  private buildSizeFactors(
    factors: { size: SizeType; factor: string | number }[],
  ) {
    const seen = new Set<SizeType>();

    return factors.map((entry) => {
      if (seen.has(entry.size)) {
        throw new BadRequestException(
          `Size ${entry.size} appears more than once in the size factors.`,
        );
      }

      seen.add(entry.size);

      const factor = new Prisma.Decimal(entry.factor);

      if (factor.lte(0)) {
        throw new BadRequestException(
          `Size factor for ${entry.size} must be greater than zero.`,
        );
      }

      return { size: entry.size, factor };
    });
  }

  private async loadRecipe(userId: string, recipeId: string) {
    const recipe = await this.prismaService.recipe.findFirst({
      where: { id: recipeId, userId },
      include: RECIPE_INCLUDE,
    });

    if (!recipe) {
      throw new NotFoundException('Recipe not found.');
    }

    return recipe;
  }

  private async buildItems(
    userId: string,
    items: RecipeItemDto[],
    context: { productId: string | null; recipeId: string | null },
  ) {
    const built = [];

    for (const [index, item] of items.entries()) {
      const hasSupply = Boolean(item.supplyId);
      const hasSubRecipe = Boolean(item.subRecipeId);

      if (hasSupply === hasSubRecipe) {
        throw new BadRequestException(
          'Each recipe item must reference exactly one of supplyId or ' +
            'subRecipeId.',
        );
      }

      const unit = await this.resolveUnit(userId, item.unit);
      const quantity = new Prisma.Decimal(item.quantity);

      if (quantity.lte(0)) {
        throw new BadRequestException(
          'Recipe item quantity must be greater than zero.',
        );
      }

      // Valida a faixa da perda já na montagem, para uma ficha nunca ser
      // gravada com um valor que o cálculo de custo recusaria depois.
      this.recipeCostingService.effectiveQuantity(1, item.wastePercent ?? 0);

      if (hasSupply) {
        const supply = await this.prismaService.supply.findFirst({
          where: { id: item.supplyId, userId },
          include: { baseUnit: true },
        });

        if (!supply) {
          throw new NotFoundException(`Supply ${item.supplyId} not found.`);
        }

        if (unit.kind !== supply.baseUnit.kind) {
          throw new BadRequestException(
            `Cannot use ${unit.code} (${unit.kind}) for ${supply.name}, whose ` +
              `base unit is ${supply.baseUnit.code} (${supply.baseUnit.kind}).`,
          );
        }

        built.push({
          supplyId: supply.id,
          subRecipeId: null,
          unitId: unit.id,
          quantity,
          quantityBase: this.unitConversionService.convert(
            quantity,
            unit,
            supply.baseUnit,
          ),
          wastePercent: new Prisma.Decimal(item.wastePercent ?? 0),
          notes: item.notes?.trim(),
          sortOrder: index,
        });

        continue;
      }

      const sub = await this.prismaService.recipe.findFirst({
        where: { id: item.subRecipeId, userId },
        include: { yieldUnit: true },
      });

      if (!sub) {
        throw new NotFoundException(`Recipe ${item.subRecipeId} not found.`);
      }

      // O ciclo é checado antes de qualquer coisa sobre unidades: uma ficha
      // que se usa a si própria é um erro mais fundamental do que uma unidade
      // faltando, e é esse o problema que precisa aparecer na mensagem.
      await this.assertNoCycle(userId, sub.id, context);

      if (!sub.yieldUnit) {
        throw new BadRequestException(
          `Recipe ${sub.name ?? sub.id} has no yield unit, so it cannot be ` +
            'used as an ingredient — there is no unit to measure it in.',
        );
      }

      if (unit.kind !== sub.yieldUnit.kind) {
        throw new BadRequestException(
          `Cannot use ${unit.code} (${unit.kind}) for sub-recipe ` +
            `${sub.name ?? sub.id}, whose yield is measured in ` +
            `${sub.yieldUnit.code} (${sub.yieldUnit.kind}).`,
        );
      }

      built.push({
        supplyId: null,
        subRecipeId: sub.id,
        unitId: unit.id,
        quantity,
        quantityBase: this.unitConversionService.convert(
          quantity,
          unit,
          sub.yieldUnit,
        ),
        wastePercent: new Prisma.Decimal(item.wastePercent ?? 0),
        notes: item.notes?.trim(),
        sortOrder: index,
      });
    }

    return built;
  }

  /**
   * Impede que uma ficha se use a si própria, direta ou indiretamente — e que
   * um prato apareça como ingrediente de si mesmo por outra versão da ficha.
   */
  private async assertNoCycle(
    userId: string,
    subRecipeId: string,
    context: { productId: string | null; recipeId: string | null },
  ) {
    const seen = new Set<string>();
    const queue = [subRecipeId];
    let depth = 0;

    while (queue.length > 0) {
      if (depth++ > MAX_DEPTH * 10) {
        throw new ConflictException('Recipe nesting is too deep.');
      }

      const currentId = queue.shift();

      if (seen.has(currentId)) {
        continue;
      }

      seen.add(currentId);

      const current = await this.prismaService.recipe.findFirst({
        where: { id: currentId, userId },
        select: {
          id: true,
          productId: true,
          items: { select: { subRecipeId: true } },
        },
      });

      if (!current) {
        continue;
      }

      if (context.recipeId && current.id === context.recipeId) {
        throw new ConflictException(
          'A recipe cannot use itself as an ingredient, not even indirectly.',
        );
      }

      if (context.productId && current.productId === context.productId) {
        throw new ConflictException(
          'A product cannot use itself as an ingredient: this sub-recipe ' +
            'belongs to the same product.',
        );
      }

      for (const item of current.items) {
        if (item.subRecipeId) {
          queue.push(item.subRecipeId);
        }
      }
    }
  }

  private async nextVersion(
    tx: Prisma.TransactionClient,
    userId: string,
    scope: { productId: string | null; name: string | null },
  ) {
    const latest = await tx.recipe.findFirst({
      where: this.siblingWhere(userId, scope),
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    return (latest?.version ?? 0) + 1;
  }

  private async deactivateSiblings(
    tx: Prisma.TransactionClient,
    userId: string,
    scope: { productId: string | null; name: string | null },
  ) {
    await tx.recipe.updateMany({
      where: { ...this.siblingWhere(userId, scope), active: true },
      data: { active: false },
    });
  }

  /** Versões que disputam a mesma vaga de "ficha ativa". */
  private siblingWhere(
    userId: string,
    scope: { productId: string | null; name: string | null },
  ): Prisma.RecipeWhereInput {
    if (scope.productId) {
      return { userId, productId: scope.productId };
    }

    // Sub-receitas não têm produto, então o nome é o que agrupa as versões.
    return { userId, productId: null, name: scope.name };
  }

  /**
   * Valida o insumo onde o subproduto é estocado.
   *
   * Exige rendimento na mesma grandeza: um molho que rende em litros não pode
   * ser estocado num insumo cuja base é grama, porque não existe conversão
   * entre volume e massa sem saber a densidade.
   */
  private async resolveOutputSupply(
    userId: string,
    outputSupplyId: string,
    isSubRecipe: boolean,
    yieldUnit: MeasurementUnit | null,
  ) {
    if (!isSubRecipe) {
      throw new BadRequestException(
        'Only a sub-recipe can have an output supply: a dish is sold, not ' +
          'stocked. Remove productId to make this a sub-recipe.',
      );
    }

    if (!yieldUnit) {
      throw new BadRequestException(
        'A produced sub-recipe needs a yield unit: without it there is no way ' +
          'to know how much of the supply one batch adds to stock.',
      );
    }

    const supply = await this.prismaService.supply.findFirst({
      where: { id: outputSupplyId, userId },
      include: { baseUnit: true },
    });

    if (!supply) {
      throw new NotFoundException(`Supply ${outputSupplyId} not found.`);
    }

    if (supply.baseUnit.kind !== yieldUnit.kind) {
      throw new BadRequestException(
        `Cannot store a yield measured in ${yieldUnit.code} (${yieldUnit.kind}) ` +
          `into ${supply.name}, whose base unit is ${supply.baseUnit.code} ` +
          `(${supply.baseUnit.kind}).`,
      );
    }

    return supply;
  }

  private async resolveYieldUnit(
    userId: string,
    dto: { yieldUnit?: string },
    isSubRecipe: boolean,
  ): Promise<MeasurementUnit | null> {
    if (!dto.yieldUnit) {
      if (isSubRecipe) {
        throw new BadRequestException(
          'A sub-recipe needs a yield unit: without it there is no way to ' +
            'measure how much of it another recipe uses.',
        );
      }

      return null;
    }

    return this.resolveUnit(userId, dto.yieldUnit);
  }

  private async resolveUnit(userId: string, code: string) {
    const normalized = code.trim().toUpperCase();

    const unit = await this.prismaService.measurementUnit.findFirst({
      where: {
        code: normalized,
        active: true,
        OR: [{ userId: null }, { userId }],
      },
    });

    if (!unit) {
      throw new NotFoundException(`Measurement unit ${normalized} not found.`);
    }

    return unit;
  }
}
