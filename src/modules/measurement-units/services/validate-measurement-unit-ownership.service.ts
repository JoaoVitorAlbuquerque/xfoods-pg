import { Injectable, NotFoundException } from '@nestjs/common';
import { MeasurementUnit } from '@prisma/client';

import { MeasurementUnitsRepository } from 'src/shared/database/repositories/measurement-units.repositories';

@Injectable()
export class ValidateMeasurementUnitOwnershipService {
  constructor(
    private readonly measurementUnitsRepo: MeasurementUnitsRepository,
  ) {}

  /**
   * Diferente dos outros validadores do projeto, este também aceita unidades
   * de sistema (`userId` nulo): elas fazem parte do catálogo que o usuário
   * enxerga. Quem barra a edição delas é o `assertEditable` do service, que
   * responde 403 em vez de 404 — o usuário precisa saber que a unidade existe
   * e é imutável, não que ela não existe.
   */
  async validate(userId: string, unitId: string): Promise<MeasurementUnit> {
    const unit = await this.measurementUnitsRepo.findFirst({
      where: { id: unitId, OR: [{ userId: null }, { userId }] },
    });

    if (!unit) {
      throw new NotFoundException('Measurement unit not found.');
    }

    return unit;
  }
}
