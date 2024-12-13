import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UsersRepository } from './repositories/users.repositories';
import { CategoriesRepository } from './repositories/categories.repositories';
import { IngredientsRepository } from './repositories/ingredients.repositories';
import { ProductsRepository } from './repositories/products.repositories';
import { OrdersRepository } from './repositories/orders.repositories';

@Global()
@Module({
  providers: [
    PrismaService,
    UsersRepository,
    CategoriesRepository,
    IngredientsRepository,
    ProductsRepository,
    OrdersRepository,
  ],
  exports: [
    UsersRepository,
    CategoriesRepository,
    IngredientsRepository,
    ProductsRepository,
    OrdersRepository,
  ],
})
export class DatabaseModule {}
