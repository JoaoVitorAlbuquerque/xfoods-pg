import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UsersRepository } from './repositories/users.repositories';
import { CategoriesRepository } from './repositories/categories.repositories';
import { IngredientsRepository } from './repositories/ingredients.repositories';

@Global()
@Module({
  providers: [
    PrismaService,
    UsersRepository,
    CategoriesRepository,
    IngredientsRepository,
  ],
  exports: [UsersRepository, CategoriesRepository, IngredientsRepository],
})
export class DatabaseModule {}
