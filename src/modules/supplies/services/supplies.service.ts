import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

import { SuppliesRepository } from 'src/shared/database/repositories/supplies.repositories';
import { SupplyCategoriesRepository } from 'src/shared/database/repositories/supply-categories.repositories';
import { StockMovementsRepository } from 'src/shared/database/repositories/stock-movements.repositories';
import { MeasurementUnitsService } from 'src/modules/measurement-units/services/measurement-units.service';
import { StockMovementsService } from 'src/modules/stock/services/stock-movements.service';
import {
  StockLevelService,
  StockStatus,
} from 'src/modules/stock/services/stock-level.service';
import { CreateSupplyDto } from '../dto/create-supply.dto';
import { UpdateSupplyDto } from '../dto/update-supply.dto';
import { ListSuppliesDto } from '../dto/list-supplies.dto';
import { ValidateSupplyOwnershipService } from './validate-supply-ownership.service';

const SUPPLY_INCLUDE = {
  category: { select: { id: true, name: true } },
  baseUnit: { select: { id: true, code: true, name: true, kind: true } },
} satisfies Prisma.SupplyInclude;

@Injectable()
export class SuppliesService {
  constructor(
    private readonly suppliesRepo: SuppliesRepository,
    private readonly supplyCategoriesRepo: SupplyCategoriesRepository,
    private readonly stockMovementsRepo: StockMovementsRepository,
    private readonly measurementUnitsService: MeasurementUnitsService,
    private readonly stockMovementsService: StockMovementsService,
    private readonly stockLevelService: StockLevelService,
    private readonly validateOwnershipService: ValidateSupplyOwnershipService,
  ) {}

  async findAllByUserId(userId: string, filters: ListSuppliesDto) {
    const supplies = await this.suppliesRepo.findMany({
      where: {
        userId,
        ...(filters.search
          ? { name: { contains: filters.search.trim(), mode: 'insensitive' } }
          : {}),
        ...(filters.supplyCategoryId
          ? { supplyCategoryId: filters.supplyCategoryId }
          : {}),
        ...(filters.active === undefined
          ? {}
          : { active: filters.active === 'true' }),
      },
      include: SUPPLY_INCLUDE,
      orderBy: { name: 'asc' },
    });

    const decorated = supplies.map((supply) => this.withStockStatus(supply));

    // O filtro por situação de estoque é aplicado depois da consulta porque
    // depende de comparar saldo com mínimo e máximo linha a linha — regra que
    // vive no StockLevelService, não no banco.
    if (!filters.stockStatus) {
      return decorated;
    }

    return decorated.filter((supply) => supply.stockStatus === filters.stockStatus);
  }

  async findOne(userId: string, supplyId: string) {
    await this.validateOwnershipService.validate(userId, supplyId);

    const supply = await this.suppliesRepo.findFirst({
      where: { id: supplyId, userId },
      include: SUPPLY_INCLUDE,
    });

    const lastMovements = await this.stockMovementsRepo.findMany({
      where: { userId, supplyId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 10,
      include: { unit: { select: { code: true } } },
    });

    return {
      ...this.withStockStatus(supply),
      lastMovements,
    };
  }

  async create(userId: string, dto: CreateSupplyDto) {
    const name = dto.name.trim();

    const existing = await this.suppliesRepo.findFirst({
      where: { userId, name },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`You already have a supply named ${name}.`);
    }

    const baseUnit = await this.measurementUnitsService.findByCodeOrFail(
      userId,
      dto.baseUnit,
    );

    if (baseUnit.isPackaging || baseUnit.factorToBase === null) {
      throw new BadRequestException(
        `${baseUnit.code} cannot be a base unit: packaging units have no ` +
          'universal conversion factor, so a purchase could never be turned ' +
          'into a balance.',
      );
    }

    await this.assertCategoryBelongsToUser(userId, dto.supplyCategoryId);

    const minStock = new Prisma.Decimal(dto.minStock ?? 0);
    const maxStock =
      dto.maxStock === undefined ? null : new Prisma.Decimal(dto.maxStock);

    if (maxStock !== null && maxStock.lt(minStock)) {
      throw new BadRequestException('maxStock must not be lower than minStock.');
    }

    const supply = await this.suppliesRepo.create({
      data: {
        userId,
        name,
        description: dto.description?.trim(),
        supplyCategoryId: dto.supplyCategoryId ?? null,
        baseUnitId: baseUnit.id,
        minStock,
        maxStock,
        // O saldo nasce zerado sempre. Um saldo de abertura vira movimentação
        // logo abaixo, para que nem o primeiro número do insumo apareça sem
        // registro de onde veio.
        currentStock: 0,
      },
      include: SUPPLY_INCLUDE,
    });

    const initialStock =
      dto.initialStock === undefined ? null : new Prisma.Decimal(dto.initialStock);

    if (initialStock !== null && initialStock.gt(0)) {
      await this.stockMovementsService.register(userId, {
        supplyId: supply.id,
        type: StockMovementType.ADJUSTMENT,
        direction: 'IN',
        quantity: initialStock,
        unitCode: dto.initialStockUnit,
        unitCost: dto.initialUnitCost,
        reason: 'Saldo inicial do cadastro',
        referenceType: 'SUPPLY_OPENING',
        referenceId: supply.id,
      });

      return this.findOne(userId, supply.id);
    }

    return this.withStockStatus(supply);
  }

  async update(userId: string, supplyId: string, dto: UpdateSupplyDto) {
    const current = await this.validateOwnershipService.validate(
      userId,
      supplyId,
    );

    const data: Prisma.SupplyUpdateInput = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();

      const clashing = await this.suppliesRepo.findFirst({
        where: { userId, name, NOT: { id: supplyId } },
        select: { id: true },
      });

      if (clashing) {
        throw new ConflictException(`You already have a supply named ${name}.`);
      }

      data.name = name;
    }

    if (dto.description !== undefined) {
      data.description = dto.description?.trim() ?? null;
    }

    if (dto.supplyCategoryId !== undefined) {
      await this.assertCategoryBelongsToUser(userId, dto.supplyCategoryId);
      data.category = dto.supplyCategoryId
        ? { connect: { id: dto.supplyCategoryId } }
        : { disconnect: true };
    }

    if (dto.active !== undefined) {
      data.active = dto.active;
    }

    const minStock =
      dto.minStock === undefined
        ? new Prisma.Decimal(current.minStock)
        : new Prisma.Decimal(dto.minStock);

    const maxStock =
      dto.maxStock === undefined
        ? current.maxStock === null
          ? null
          : new Prisma.Decimal(current.maxStock)
        : new Prisma.Decimal(dto.maxStock);

    if (maxStock !== null && maxStock.lt(minStock)) {
      throw new BadRequestException('maxStock must not be lower than minStock.');
    }

    if (dto.minStock !== undefined) {
      data.minStock = minStock;
    }

    if (dto.maxStock !== undefined) {
      data.maxStock = maxStock;
    }

    const updated = await this.suppliesRepo.update({
      where: { id: supplyId },
      data,
      include: SUPPLY_INCLUDE,
    });

    return this.withStockStatus(updated);
  }

  async setActive(userId: string, supplyId: string, active: boolean) {
    await this.validateOwnershipService.validate(userId, supplyId);

    const updated = await this.suppliesRepo.update({
      where: { id: supplyId },
      data: { active },
      include: SUPPLY_INCLUDE,
    });

    return this.withStockStatus(updated);
  }

  /** Acrescenta a situação de estoque calculada, sem tocar no banco. */
  withStockStatus<
    T extends { currentStock: Prisma.Decimal; minStock: Prisma.Decimal; maxStock: Prisma.Decimal | null },
  >(supply: T) {
    const stockStatus = this.stockLevelService.getStatus(supply);

    return {
      ...supply,
      stockStatus,
      needsAttention: stockStatus !== StockStatus.OK,
      shortfall: this.stockLevelService.shortfall(supply),
    };
  }

  private async assertCategoryBelongsToUser(
    userId: string,
    supplyCategoryId?: string | null,
  ) {
    if (!supplyCategoryId) {
      return;
    }

    const category = await this.supplyCategoriesRepo.findFirst({
      where: { id: supplyCategoryId, userId },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException('Supply category not found.');
    }
  }
}
