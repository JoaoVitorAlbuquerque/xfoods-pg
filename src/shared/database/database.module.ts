import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UsersRepository } from './repositories/users.repositories';
import { CategoriesRepository } from './repositories/categories.repositories';
import { IngredientsRepository } from './repositories/ingredients.repositories';
import { ProductsRepository } from './repositories/products.repositories';
import { OrdersRepository } from './repositories/orders.repositories';
import { LeadsRepository } from './repositories/leads.repositories';

@Global()
@Module({
  providers: [
    PrismaService,
    UsersRepository,
    CategoriesRepository,
    IngredientsRepository,
    ProductsRepository,
    OrdersRepository,
    LeadsRepository,
  ],
  exports: [
    UsersRepository,
    CategoriesRepository,
    IngredientsRepository,
    ProductsRepository,
    OrdersRepository,
    LeadsRepository,
  ],
})
export class DatabaseModule {}
