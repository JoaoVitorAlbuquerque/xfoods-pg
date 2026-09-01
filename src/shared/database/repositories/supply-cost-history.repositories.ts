import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class SupplyCostHistoryRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create<T extends Prisma.SupplyCostHistoryCreateArgs>(
    createDto: Prisma.SelectSubset<T, Prisma.SupplyCostHistoryCreateArgs>,
  ) {
    return this.prismaService.supplyCostHistory.create<T>(createDto);
  }

  findMany<T extends Prisma.SupplyCostHistoryFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.SupplyCostHistoryFindManyArgs>,
  ) {
    return this.prismaService.supplyCostHistory.findMany<T>(findManyDto);
  }

  findFirst<T extends Prisma.SupplyCostHistoryFindFirstArgs>(
    findFirstDto: Prisma.SelectSubset<T, Prisma.SupplyCostHistoryFindFirstArgs>,
  ) {
    return this.prismaService.supplyCostHistory.findFirst<T>(findFirstDto);
  }

  count(countDto: Prisma.SupplyCostHistoryCountArgs) {
    return this.prismaService.supplyCostHistory.count(countDto);
  }

  update<T extends Prisma.SupplyCostHistoryUpdateArgs>(
    updateDto: Prisma.SelectSubset<T, Prisma.SupplyCostHistoryUpdateArgs>,
  ) {
    return this.prismaService.supplyCostHistory.update<T>(updateDto);
  }
}
