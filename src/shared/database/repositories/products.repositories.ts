import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(updateProductDto: Prisma.ProductCreateArgs) {
    return this.prismaService.product.create(updateProductDto);
  }

  findMany(findUniqueDto: Prisma.ProductFindManyArgs) {
    return this.prismaService.product.findMany(findUniqueDto);
  }

  findFirst(findFirstDto: Prisma.ProductFindFirstArgs) {
    return this.prismaService.product.findFirst(findFirstDto);
  }

  update(updateProductDto: Prisma.ProductUpdateArgs) {
    return this.prismaService.product.update(updateProductDto);
  }

  delete(deleteProductDto: Prisma.ProductDeleteArgs) {
    return this.prismaService.product.delete(deleteProductDto);
  }
}
