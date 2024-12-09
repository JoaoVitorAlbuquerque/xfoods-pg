import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(updateCategoryDto: Prisma.CategoryCreateArgs) {
    return this.prismaService.category.create(updateCategoryDto);
  }

  findMany(findUniqueDto: Prisma.CategoryFindManyArgs) {
    return this.prismaService.category.findMany(findUniqueDto);
  }

  findFirst(findFirstDto: Prisma.CategoryFindFirstArgs) {
    return this.prismaService.category.findFirst(findFirstDto);
  }

  update(updateCategoryDto: Prisma.CategoryUpdateArgs) {
    return this.prismaService.category.update(updateCategoryDto);
  }

  delete(deleteCategoryDto: Prisma.CategoryDeleteArgs) {
    return this.prismaService.category.delete(deleteCategoryDto);
  }
}
