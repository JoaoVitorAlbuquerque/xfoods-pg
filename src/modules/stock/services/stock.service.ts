import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

import { SuppliesRepository } from 'src/shared/database/repositories/supplies.repositories';
import { StockMovementsRepository } from 'src/shared/database/repositories/stock-movements.repositories';
import { StockLevelService, StockStatus } from './stock-level.service';
import { StockMovementsService } from './stock-movements.service';
import {
  CreateStockAdjustmentDto,
  CreateStockEntryDto,
  CreateStockExitDto,
  CreateStockLossDto,
} from '../dto/stock-operation.dto';
import { ListMovementsDto } from '../dto/list-movements.dto';

@Injectable()
export class StockService {
  constructor(
    private readonly suppliesRepo: SuppliesRepository,
    private readonly stockMovementsRepo: StockMovementsRepository,
    private readonly stockLevelService: StockLevelService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  /** Posição de estoque, do mais grave para o menos grave. */
  async getOverview(userId: string, onlyAlerts = false) {
    const supplies = await this.suppliesRepo.findMany({
      where: { userId, active: true },
      include: {
        baseUnit: { select: { code: true, name: true, kind: true } },
        category: { select: { id: true, name: true } },
      },
    });

    const rows = supplies
      .map((supply) => {
        const stockStatus = this.stockLevelService.getStatus(supply);

        return {
          id: supply.id,
          name: supply.name,
          category: supply.category,
          baseUnit: supply.baseUnit,
          currentStock: supply.currentStock,
          minStock: supply.minStock,
          maxStock: supply.maxStock,
          averageCost: supply.averageCost,
          stockValue: new Prisma.Decimal(supply.currentStock).mul(
            supply.averageCost,
          ),
          stockStatus,
          shortfall: this.stockLevelService.shortfall(supply),
        };
      })
      .filter((row) => (onlyAlerts ? row.stockStatus !== StockStatus.OK : true))
      .sort((a, b) => {
        const bySeverity =
          this.stockLevelService.severity(a.stockStatus) -
          this.stockLevelService.severity(b.stockStatus);

        return bySeverity !== 0 ? bySeverity : a.name.localeCompare(b.name);
      });

    return {
      items: rows,
      summary: {
        total: rows.length,
        negative: rows.filter((r) => r.stockStatus === StockStatus.NEGATIVE)
          .length,
        zero: rows.filter((r) => r.stockStatus === StockStatus.ZERO).length,
        low: rows.filter((r) => r.stockStatus === StockStatus.LOW).length,
        over: rows.filter((r) => r.stockStatus === StockStatus.OVER).length,
        totalValue: rows.reduce(
          (total, row) => total.add(row.stockValue),
          new Prisma.Decimal(0),
        ),
      },
    };
  }

  async getMovements(userId: string, filters: ListMovementsDto) {
    const where: Prisma.StockMovementWhereInput = {
      userId,
      ...(filters.supplyId ? { supplyId: filters.supplyId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.from || filters.to
        ? {
            occurredAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.stockMovementsRepo.findMany({
        where,
        include: {
          supply: { select: { id: true, name: true } },
          unit: { select: { code: true, name: true } },
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.stockMovementsRepo.count({ where }),
    ]);

    return {
      items: items.map((movement) => ({
        ...movement,
        // O sinal vive só na quantidade; a direção é derivada dele para a
        // interface não precisar reimplementar a convenção.
        direction: new Prisma.Decimal(movement.quantityBase).isNegative()
          ? 'OUT'
          : 'IN',
      })),
      total,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    };
  }

  registerEntry(userId: string, dto: CreateStockEntryDto) {
    return this.stockMovementsService.register(userId, {
      supplyId: dto.supplyId,
      type: dto.type ?? StockMovementType.PURCHASE,
      direction: 'IN',
      quantity: dto.quantity,
      unitCode: dto.unit,
      unitCost: dto.unitCost,
      reason: dto.reason,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });
  }

  registerExit(userId: string, dto: CreateStockExitDto) {
    return this.stockMovementsService.register(userId, {
      supplyId: dto.supplyId,
      type: dto.type,
      direction: 'OUT',
      quantity: dto.quantity,
      unitCode: dto.unit,
      reason: dto.reason,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });
  }

  registerLoss(userId: string, dto: CreateStockLossDto) {
    return this.stockMovementsService.register(userId, {
      supplyId: dto.supplyId,
      type: StockMovementType.LOSS,
      direction: 'OUT',
      quantity: dto.quantity,
      unitCode: dto.unit,
      reason: dto.reason,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });
  }

  async registerAdjustment(userId: string, dto: CreateStockAdjustmentDto) {
    const result = await this.stockMovementsService.adjustTo(userId, {
      supplyId: dto.supplyId,
      targetQuantity: dto.targetQuantity,
      unitCode: dto.unit,
      reason: dto.reason,
      referenceType: 'MANUAL_ADJUSTMENT',
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });

    return {
      movement: result.movement,
      systemQuantity: result.systemQuantityBase,
      countedQuantity: result.countedQuantityBase,
      difference: result.differenceBase,
      // Ajuste sem diferença não gera movimento: registrar um lançamento de
      // zero só poluiria o extrato.
      applied: result.movement !== null,
    };
  }
}
