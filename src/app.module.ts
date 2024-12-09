import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DatabaseModule } from './shared/database/database.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { CategoriesModule } from './modules/categories/categories.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';

@Module({
  imports: [UsersModule, DatabaseModule, AuthModule, CategoriesModule, IngredientsModule],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
