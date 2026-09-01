import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class MeasurementUnitsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(createDto: Prisma.MeasurementUnitCreateArgs) {
    return this.prismaService.measurementUnit.create(createDto);
  }

  findMany(findManyDto: Prisma.MeasurementUnitFindManyArgs) {
    return this.prismaService.measurementUnit.findMany(findManyDto);
  }

  findFirst(findFirstDto: Prisma.MeasurementUnitFindFirstArgs) {
    return this.prismaService.measurementUnit.findFirst(findFirstDto);
  }

  update(updateDto: Prisma.MeasurementUnitUpdateArgs) {
    return this.prismaService.measurementUnit.update(updateDto);
  }

  delete(deleteDto: Prisma.MeasurementUnitDeleteArgs) {
    return this.prismaService.measurementUnit.delete(deleteDto);
  }
}
