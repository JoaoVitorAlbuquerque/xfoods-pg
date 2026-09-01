import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CostSource,
  Prisma,
  PurchaseStatus,
  StockMovementType,
} from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { PurchasesRepository } from 'src/shared/database/repositories/purchases.repositories';
import { UnitConversionService } from 'src/modules/measurement-units/services/unit-conversion.service';
import { StockMovementsService } from 'src/modules/stock/services/stock-movements.service';
import { CreatePurchaseDto } from '../dto/create-purchase.dto';
import { ListPurchasesDto } from '../dto/list-purchases.dto';

const PURCHASE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  items: {
    include: {
      supply: {
        select: { id: true, name: true, baseUnit: { select: { code: true } } },
      },
      unit: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.PurchaseInclude;

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly purchasesRepo: PurchasesRepository,
    private readonly unitConversionService: UnitConversionService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  async findAllByUserId(userId: string, filters: ListPurchasesDto) {
    const where: Prisma.PurchaseWhereInput = {
      userId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(filters.supplyId
        ? { items: { some: { supplyId: filters.supplyId } } }
        : {}),
      ...(filters.from || filters.to
        ? {
            issuedAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.purchasesRepo.findMany({
        where,
        include: PURCHASE_INCLUDE,
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.purchasesRepo.count({ where }),
    ]);

    return {
      items,
      total,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    };
  }

  async findOne(userId: string, purchaseId: string) {
    const purchase = await this.purchasesRepo.findFirst({
      where: { id: purchaseId, userId },
      include: PURCHASE_INCLUDE,
    });

    if (!purchase) {
      throw new NotFoundException('Purchase not found.');
    }

    return purchase;
  }

  async create(userId: string, dto: CreatePurchaseDto) {
    if (dto.supplierId) {
      const supplier = await this.prismaService.supplier.findFirst({
        where: { id: dto.supplierId, userId },
        select: { id: true },
      });

      if (!supplier) {
        throw new NotFoundException('Supplier not found.');
      }
    }

    const supplyIds = [...new Set(dto.items.map((item) => item.supplyId))];

    const supplies = await this.prismaService.supply.findMany({
      where: { id: { in: supplyIds }, userId },
      include: { baseUnit: true },
    });

    if (supplies.length !== supplyIds.length) {
      throw new NotFoundException('Some supplies were not found for this user.');
    }

    const supplyById = new Map(supplies.map((supply) => [supply.id, supply]));

    const items = await Promise.all(
      dto.items.map((item) => this.buildItem(userId, item, supplyById)),
    );

    const totalAmount = items.reduce(
      (total, item) => total.add(item.totalPrice),
      new Prisma.Decimal(0),
    );

    return this.purchasesRepo.create({
      data: {
        userId,
        supplierId: dto.supplierId ?? null,
        documentNumber: dto.documentNumber?.trim(),
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : new Date(),
        notes: dto.notes?.trim(),
        totalAmount,
        // Nasce rascunho: nada de estoque acontece até a confirmação.
        status: PurchaseStatus.DRAFT,
        items: { create: items },
      },
      include: PURCHASE_INCLUDE,
    });
  }

  /**
   * Confirma a compra: gera as movimentações de entrada, atualiza o custo atual
   * de cada insumo e acrescenta uma linha ao histórico de custo.
   *
   * Tudo em uma transação. Uma compra aplicada pela metade deixaria estoque
   * somado sem custo atualizado — e ninguém saberia quais itens já entraram.
   */
  async confirm(userId: string, purchaseId: string) {
    const purchase = await this.findOne(userId, purchaseId);

    if (purchase.status !== PurchaseStatus.DRAFT) {
      throw new ConflictException(
        `Purchase is ${purchase.status} and can no longer be confirmed.`,
      );
    }

    return this.prismaService.$transaction(async (tx) => {
      // Trava de idempotência: se outra requisição confirmou entre a leitura
      // acima e este ponto, nenhuma linha é afetada e nada é lançado.
      const claimed = await tx.purchase.updateMany({
        where: { id: purchaseId, userId, status: PurchaseStatus.DRAFT },
        data: {
          status: PurchaseStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictException(
          'Purchase was already confirmed by another request.',
        );
      }

      for (const item of purchase.items) {
        // O custo anterior precisa ser lido antes da movimentação, que é quem
        // sobrescreve `lastCost` — depois dela já seria o custo novo.
        const before = await tx.supply.findUnique({
          where: { id: item.supplyId },
          select: { lastCost: true },
        });

        const previousUnitCostBase =
          before?.lastCost === null || before?.lastCost === undefined
            ? null
            : new Prisma.Decimal(before.lastCost);

        const movement = await this.stockMovementsService.register(
          userId,
          {
            supplyId: item.supplyId,
            type: StockMovementType.PURCHASE,
            direction: 'IN',
            quantity: item.quantity,
            unitCode: item.unit.code,
            // Passa o custo já em unidade base: recalcular a partir do preço
            // unitário reintroduziria o arredondamento da divisão feita na
            // criação da compra.
            unitCostBase: item.unitCostBase,
            reason: purchase.documentNumber
              ? `Compra ${purchase.documentNumber}`
              : 'Compra',
            referenceType: 'PURCHASE',
            referenceId: purchase.id,
            occurredAt: purchase.issuedAt,
          },
          tx,
        );

        await tx.purchaseItem.update({
          where: { id: item.id },
          data: { movementId: movement.id },
        });

        // `lastCost` e `averageCost` já foram gravados pela movimentação.
        // Aqui entram os dados que só a compra conhece.
        await tx.supply.update({
          where: { id: item.supplyId },
          data: {
            lastPurchaseAt: purchase.issuedAt,
            lastSupplierId: purchase.supplierId,
            lastPurchaseUnitPrice: item.unitPrice,
            lastPurchaseUnitId: item.unitId,
          },
        });

        await tx.supplyCostHistory.create({
          data: {
            userId,
            supplyId: item.supplyId,
            unitCostBase: item.unitCostBase,
            previousUnitCostBase,
            variationPercent: this.variationPercent(
              previousUnitCostBase,
              new Prisma.Decimal(item.unitCostBase),
            ),
            unitPrice: item.unitPrice,
            unitId: item.unitId,
            source: CostSource.PURCHASE,
            purchaseItemId: item.id,
            supplierId: purchase.supplierId,
            effectiveAt: purchase.issuedAt,
          },
        });
      }

      return tx.purchase.findUnique({
        where: { id: purchaseId },
        include: PURCHASE_INCLUDE,
      });
    });
  }

  /**
   * Só rascunho pode ser cancelado. Cancelar uma compra confirmada exigiria
   * devolver o estoque e reconstruir o custo atual a partir da linha anterior
   * do histórico — é um estorno, e ele ainda não existe.
   */
  async cancel(userId: string, purchaseId: string) {
    const purchase = await this.findOne(userId, purchaseId);

    if (purchase.status !== PurchaseStatus.DRAFT) {
      throw new ConflictException(
        `Only a draft purchase can be canceled; this one is ${purchase.status}. ` +
          'Reversing a confirmed purchase requires a stock reversal, which is ' +
          'not implemented yet.',
      );
    }

    return this.purchasesRepo.update({
      where: { id: purchaseId },
      data: { status: PurchaseStatus.CANCELED, canceledAt: new Date() },
      include: PURCHASE_INCLUDE,
    });
  }

  private async buildItem(
    userId: string,
    item: CreatePurchaseDto['items'][number],
    supplyById: Map<string, { id: string; name: string; baseUnit: any }>,
  ) {
    const supply = supplyById.get(item.supplyId);

    const hasUnitPrice = item.unitPrice !== undefined && item.unitPrice !== null;
    const hasTotalPrice =
      item.totalPrice !== undefined && item.totalPrice !== null;

    if (hasUnitPrice === hasTotalPrice) {
      throw new BadRequestException(
        `Item for ${supply.name}: inform exactly one of unitPrice or ` +
          'totalPrice — the other one is calculated.',
      );
    }

    const unit = await this.resolveUnit(userId, item.unit);

    if (unit.kind !== supply.baseUnit.kind) {
      throw new BadRequestException(
        `Cannot buy ${supply.name} in ${unit.code} (${unit.kind}): its base ` +
          `unit is ${supply.baseUnit.code} (${supply.baseUnit.kind}).`,
      );
    }

    const quantity = new Prisma.Decimal(item.quantity);
    const quantityBase = this.unitConversionService.convert(
      quantity,
      unit,
      supply.baseUnit,
    );

    const unitPrice = hasUnitPrice
      ? new Prisma.Decimal(item.unitPrice)
      : new Prisma.Decimal(item.totalPrice).div(quantity);

    const totalPrice = hasTotalPrice
      ? new Prisma.Decimal(item.totalPrice)
      : unitPrice.mul(quantity);

    // O custo por unidade base sai do total da linha, não do preço unitário:
    // é ele que permite comparar uma compra em KG com outra em G.
    // 10 KG por R$ 350 -> 10.000 G -> R$ 0,035/G
    const unitCostBase = totalPrice.div(quantityBase);

    return {
      supplyId: supply.id,
      unitId: unit.id,
      quantity,
      quantityBase,
      unitPrice,
      totalPrice,
      unitCostBase,
      batch: item.batch?.trim(),
      expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
    };
  }

  private variationPercent(
    previous: Prisma.Decimal | null,
    current: Prisma.Decimal,
  ): Prisma.Decimal | null {
    // Sem compra anterior, ou com custo anterior zerado, não há variação a
    // calcular — devolver 0 ou 100 seria inventar um número.
    if (previous === null || previous.lte(0)) {
      return null;
    }

    return current.sub(previous).div(previous).mul(100);
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
