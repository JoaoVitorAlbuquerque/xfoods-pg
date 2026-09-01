import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockCountStatus } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { StockCountsRepository } from 'src/shared/database/repositories/stock-counts.repositories';
import { StockMovementsService } from './stock-movements.service';
import { UnitConversionService } from 'src/modules/measurement-units/services/unit-conversion.service';
import { CreateStockCountDto } from '../dto/create-stock-count.dto';

const COUNT_INCLUDE = {
  items: {
    include: {
      supply: { select: { id: true, name: true } },
      unit: { select: { code: true } },
    },
  },
} satisfies Prisma.StockCountInclude;

/**
 * Contagem física. Nasce OPEN e não toca no estoque; ao ser aplicada, cada item
 * com diferença gera um ADJUSTMENT.
 *
 * A separação entre contar e aplicar existe porque contar leva tempo: alguém
 * anda pelo estoque com uma prancheta enquanto a operação continua. O saldo do
 * sistema usado na diferença é o do instante da aplicação, não o da digitação.
 */
@Injectable()
export class StockCountsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly stockCountsRepo: StockCountsRepository,
    private readonly stockMovementsService: StockMovementsService,
    private readonly unitConversionService: UnitConversionService,
  ) {}

  findAllByUserId(userId: string) {
    return this.stockCountsRepo.findMany({
      where: { userId },
      orderBy: { countedAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async findOne(userId: string, stockCountId: string) {
    const stockCount = await this.stockCountsRepo.findFirst({
      where: { id: stockCountId, userId },
      include: COUNT_INCLUDE,
    });

    if (!stockCount) {
      throw new NotFoundException('Stock count not found.');
    }

    return stockCount;
  }

  async create(userId: string, dto: CreateStockCountDto) {
    const supplyIds = dto.items.map((item) => item.supplyId);
    const uniqueIds = new Set(supplyIds);

    if (uniqueIds.size !== supplyIds.length) {
      throw new BadRequestException(
        'The same supply cannot appear twice in one count.',
      );
    }

    const supplies = await this.prismaService.supply.findMany({
      where: { id: { in: [...uniqueIds] }, userId },
      include: { baseUnit: true },
    });

    if (supplies.length !== uniqueIds.size) {
      throw new NotFoundException('Some supplies were not found for this user.');
    }

    const supplyById = new Map(supplies.map((supply) => [supply.id, supply]));

    // A conversão para a unidade base acontece na criação para que o valor
    // contado já fique registrado de forma comparável, mesmo que a contagem
    // demore para ser aplicada.
    const items = await Promise.all(
      dto.items.map(async (item) => {
        const supply = supplyById.get(item.supplyId);
        const unit = item.unit
          ? await this.resolveUnit(userId, item.unit)
          : supply.baseUnit;

        if (unit.kind !== supply.baseUnit.kind) {
          throw new BadRequestException(
            `Cannot count ${supply.name} in ${unit.code} (${unit.kind}): its ` +
              `base unit is ${supply.baseUnit.code} (${supply.baseUnit.kind}).`,
          );
        }

        const countedQuantity = new Prisma.Decimal(item.countedQuantity);

        return {
          supplyId: supply.id,
          unitId: unit.id,
          countedQuantity,
          countedQuantityBase: this.unitConversionService.convert(
            countedQuantity,
            unit,
            supply.baseUnit,
          ),
        };
      }),
    );

    return this.stockCountsRepo.create({
      data: {
        userId,
        note: dto.note?.trim(),
        countedAt: dto.countedAt ? new Date(dto.countedAt) : undefined,
        items: { create: items },
      },
      include: COUNT_INCLUDE,
    });
  }

  async apply(userId: string, stockCountId: string) {
    const stockCount = await this.findOne(userId, stockCountId);

    if (stockCount.status !== StockCountStatus.OPEN) {
      throw new ConflictException(
        `Stock count is ${stockCount.status} and can no longer be applied.`,
      );
    }

    // Tudo em uma transação: ou o inventário inteiro entra, ou nenhum ajuste
    // entra. Um inventário aplicado pela metade é pior do que nenhum, porque
    // ninguém sabe quais insumos já foram corrigidos.
    return this.prismaService.$transaction(async (tx) => {
      const applied = await tx.stockCount.updateMany({
        where: { id: stockCountId, userId, status: StockCountStatus.OPEN },
        data: { status: StockCountStatus.APPLIED, appliedAt: new Date() },
      });

      // Trava de idempotência: se outra requisição aplicou a contagem entre a
      // leitura acima e este ponto, nenhuma linha é afetada e nada é ajustado.
      if (applied.count !== 1) {
        throw new ConflictException(
          'Stock count was already applied by another request.',
        );
      }

      for (const item of stockCount.items) {
        const result = await this.stockMovementsService.adjustTo(
          userId,
          {
            supplyId: item.supplyId,
            targetQuantity: item.countedQuantityBase,
            unitCode: undefined,
            reason: `Inventário ${stockCount.countedAt.toISOString().slice(0, 10)}`,
            referenceType: 'STOCK_COUNT',
            referenceId: stockCount.id,
          },
          tx,
        );

        await tx.stockCountItem.update({
          where: { id: item.id },
          data: {
            systemQuantityBase: result.systemQuantityBase,
            differenceBase: result.differenceBase,
            movementId: result.movement?.id ?? null,
          },
        });
      }

      return tx.stockCount.findUnique({
        where: { id: stockCountId },
        include: COUNT_INCLUDE,
      });
    });
  }

  async cancel(userId: string, stockCountId: string) {
    const stockCount = await this.findOne(userId, stockCountId);

    if (stockCount.status !== StockCountStatus.OPEN) {
      throw new ConflictException(
        `Only an open stock count can be canceled; this one is ${stockCount.status}.`,
      );
    }

    return this.stockCountsRepo.update({
      where: { id: stockCountId },
      data: { status: StockCountStatus.CANCELED, canceledAt: new Date() },
      include: COUNT_INCLUDE,
    });
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
