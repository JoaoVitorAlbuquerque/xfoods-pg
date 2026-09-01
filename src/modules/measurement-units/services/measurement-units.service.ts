import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MeasurementUnit, Prisma, UnitKind } from '@prisma/client';

import { MeasurementUnitsRepository } from 'src/shared/database/repositories/measurement-units.repositories';
import { CreateMeasurementUnitDto } from '../dto/create-measurement-unit.dto';
import { UpdateMeasurementUnitDto } from '../dto/update-measurement-unit.dto';
import { ConvertQuantityDto } from '../dto/convert-quantity.dto';
import { UnitConversionService } from './unit-conversion.service';
import { ValidateMeasurementUnitOwnershipService } from './validate-measurement-unit-ownership.service';

@Injectable()
export class MeasurementUnitsService {
  constructor(
    private readonly measurementUnitsRepo: MeasurementUnitsRepository,
    private readonly unitConversionService: UnitConversionService,
    private readonly validateOwnershipService: ValidateMeasurementUnitOwnershipService,
  ) {}

  /**
   * Catálogo visível ao estabelecimento: as unidades de sistema (user_id nulo,
   * compartilhadas) mais as que ele mesmo criou.
   */
  findAllByUserId(userId: string, includeInactive = false) {
    return this.measurementUnitsRepo.findMany({
      where: {
        OR: [{ userId: null }, { userId }],
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateMeasurementUnitDto) {
    const code = dto.code.trim().toUpperCase();
    const isPackaging = dto.isPackaging ?? false;

    // Embalagem não tem fator universal; qualquer outra unidade precisa de um,
    // senão ela entra no catálogo sem poder ser convertida.
    if (isPackaging && dto.factorToBase !== undefined) {
      throw new BadRequestException(
        'A packaging unit must not define factorToBase: its factor depends on ' +
          'the supply and is defined per supply.',
      );
    }

    if (!isPackaging && dto.factorToBase === undefined) {
      throw new BadRequestException(
        'factorToBase is required unless the unit is a packaging unit.',
      );
    }

    let factorToBase: Prisma.Decimal | null = null;

    if (!isPackaging) {
      factorToBase = new Prisma.Decimal(dto.factorToBase);

      if (!factorToBase.isFinite() || factorToBase.lte(0)) {
        throw new BadRequestException(
          'factorToBase must be greater than zero.',
        );
      }
    }

    // O código precisa ser único no catálogo inteiro que este usuário enxerga,
    // não só entre as unidades dele: um "KG" próprio conviveria com o "KG" de
    // sistema e tornaria ambíguo a qual deles uma ficha técnica se refere.
    const conflicting = await this.measurementUnitsRepo.findFirst({
      where: { code, OR: [{ userId: null }, { userId }] },
      select: { id: true, isSystem: true },
    });

    if (conflicting) {
      throw new ConflictException(
        conflicting.isSystem
          ? `${code} is a system unit and cannot be redefined.`
          : `You already have a unit with code ${code}.`,
      );
    }

    return this.measurementUnitsRepo.create({
      data: {
        userId,
        code,
        name: dto.name.trim(),
        kind: dto.kind,
        factorToBase,
        isPackaging,
        // Nem `isSystem` nem `isBase` são aceitos do cliente. Unidade de
        // sistema só nasce pela migração, e a base de cada grandeza já existe.
        isSystem: false,
        isBase: false,
      },
    });
  }

  async update(userId: string, unitId: string, dto: UpdateMeasurementUnitDto) {
    const unit = await this.validateOwnershipService.validate(userId, unitId);

    this.assertEditable(unit);

    const data: Prisma.MeasurementUnitUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.active !== undefined) {
      data.active = dto.active;
    }

    // `code` e `kind` não são editáveis: alterá-los reescreveria o significado
    // de toda quantidade já registrada com esta unidade. O caminho é desativar
    // e criar outra.
    if (dto.code !== undefined && dto.code.trim().toUpperCase() !== unit.code) {
      throw new BadRequestException(
        'code cannot be changed. Deactivate this unit and create a new one.',
      );
    }

    if (dto.kind !== undefined && dto.kind !== unit.kind) {
      throw new BadRequestException(
        'kind cannot be changed. Deactivate this unit and create a new one.',
      );
    }

    if (dto.factorToBase !== undefined) {
      if (unit.isPackaging) {
        throw new BadRequestException(
          'A packaging unit has no universal factor to update.',
        );
      }

      const factorToBase = new Prisma.Decimal(dto.factorToBase);

      if (!factorToBase.isFinite() || factorToBase.lte(0)) {
        throw new BadRequestException(
          'factorToBase must be greater than zero.',
        );
      }

      data.factorToBase = factorToBase;
    }

    return this.measurementUnitsRepo.update({
      where: { id: unitId },
      data,
    });
  }

  /**
   * Desativa em vez de apagar. A unidade vai ser referenciada por insumos,
   * compras e fichas técnicas; remover a linha apagaria o significado das
   * quantidades já gravadas com ela.
   */
  async remove(userId: string, unitId: string) {
    const unit = await this.validateOwnershipService.validate(userId, unitId);

    this.assertEditable(unit);

    await this.measurementUnitsRepo.update({
      where: { id: unitId },
      data: { active: false },
    });

    return null;
  }

  async convert(userId: string, dto: ConvertQuantityDto) {
    const from = await this.findByCodeOrFail(userId, dto.from);
    const to = await this.findByCodeOrFail(userId, dto.to);

    const result = this.unitConversionService.convert(dto.quantity, from, to);

    return {
      quantity: dto.quantity,
      from: from.code,
      to: to.code,
      kind: from.kind,
      // String preserva a precisão que o JSON perderia ao virar float. O
      // interceptor global converte Decimal em number, então o valor sai
      // explicitamente serializado aqui.
      result: result.toString(),
    };
  }

  async findByCodeOrFail(userId: string, code: string) {
    const unit = await this.measurementUnitsRepo.findFirst({
      where: {
        code: code.trim().toUpperCase(),
        active: true,
        OR: [{ userId: null }, { userId }],
      },
    });

    if (!unit) {
      throw new NotFoundException(
        `Measurement unit ${code.trim().toUpperCase()} not found.`,
      );
    }

    return unit;
  }

  /** Base canônica da grandeza — o formato em que o estoque é guardado. */
  async findBaseUnit(userId: string, kind: UnitKind) {
    const unit = await this.measurementUnitsRepo.findFirst({
      where: { kind, isBase: true, OR: [{ userId: null }, { userId }] },
    });

    if (!unit) {
      throw new NotFoundException(`No base unit found for kind ${kind}.`);
    }

    return unit;
  }

  private assertEditable(unit: MeasurementUnit) {
    if (unit.isSystem) {
      throw new ForbiddenException(
        `${unit.code} is a system unit. Its conversion factor is a physical ` +
          'constant and is shared by every establishment.',
      );
    }
  }
}
