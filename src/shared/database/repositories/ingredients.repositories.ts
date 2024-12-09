import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class IngredientsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(updateIngredientDto: Prisma.IngredientCreateArgs) {
    return this.prismaService.ingredient.create(updateIngredientDto);
  }

  findMany(findUniqueDto: Prisma.IngredientFindManyArgs) {
    return this.prismaService.ingredient.findMany(findUniqueDto);
  }

  findFirst(findFirstDto: Prisma.IngredientFindFirstArgs) {
    return this.prismaService.ingredient.findFirst(findFirstDto);
  }

  update(updateIngredientDto: Prisma.IngredientUpdateArgs) {
    return this.prismaService.ingredient.update(updateIngredientDto);
  }

  delete(deleteIngredientDto: Prisma.IngredientDeleteArgs) {
    return this.prismaService.ingredient.delete(deleteIngredientDto);
  }
}
