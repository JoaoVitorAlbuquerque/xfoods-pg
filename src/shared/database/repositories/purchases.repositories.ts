import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class PurchasesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create<T extends Prisma.PurchaseCreateArgs>(
    createDto: Prisma.SelectSubset<T, Prisma.PurchaseCreateArgs>,
  ) {
    return this.prismaService.purchase.create<T>(createDto);
  }

  findMany<T extends Prisma.PurchaseFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.PurchaseFindManyArgs>,
  ) {
    return this.prismaService.purchase.findMany<T>(findManyDto);
  }

  findFirst<T extends Prisma.PurchaseFindFirstArgs>(
    findFirstDto: Prisma.SelectSubset<T, Prisma.PurchaseFindFirstArgs>,
  ) {
    return this.prismaService.purchase.findFirst<T>(findFirstDto);
  }

  count(countDto: Prisma.PurchaseCountArgs) {
    return this.prismaService.purchase.count(countDto);
  }

  update<T extends Prisma.PurchaseUpdateArgs>(
    updateDto: Prisma.SelectSubset<T, Prisma.PurchaseUpdateArgs>,
  ) {
    return this.prismaService.purchase.update<T>(updateDto);
  }
}
