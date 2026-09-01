import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class SuppliersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create<T extends Prisma.SupplierCreateArgs>(
    createDto: Prisma.SelectSubset<T, Prisma.SupplierCreateArgs>,
  ) {
    return this.prismaService.supplier.create<T>(createDto);
  }

  findMany<T extends Prisma.SupplierFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.SupplierFindManyArgs>,
  ) {
    return this.prismaService.supplier.findMany<T>(findManyDto);
  }

  findFirst<T extends Prisma.SupplierFindFirstArgs>(
    findFirstDto: Prisma.SelectSubset<T, Prisma.SupplierFindFirstArgs>,
  ) {
    return this.prismaService.supplier.findFirst<T>(findFirstDto);
  }

  count(countDto: Prisma.SupplierCountArgs) {
    return this.prismaService.supplier.count(countDto);
  }

  update<T extends Prisma.SupplierUpdateArgs>(
    updateDto: Prisma.SelectSubset<T, Prisma.SupplierUpdateArgs>,
  ) {
    return this.prismaService.supplier.update<T>(updateDto);
  }
}
