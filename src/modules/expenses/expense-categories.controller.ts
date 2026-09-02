import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { ExpenseCategoriesService } from './services/expense-categories.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-category.dto';

@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly categoriesService: ExpenseCategoriesService) {}

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.categoriesService.findAllByUserId(userId);
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createExpenseCategoryDto: CreateExpenseCategoryDto,
  ) {
    return this.categoriesService.create(userId, createExpenseCategoryDto);
  }

  /**
   * Cria as categorias sugeridas que faltarem. Idempotente e aditivo: não
   * renomeia nem apaga o que já existe, então rodar duas vezes é inofensivo.
   */
  @Post('seed')
  seed(@ActiveUserId() userId: string) {
    return this.categoriesService.seedSuggested(userId);
  }

  @Put(':categoryId')
  update(
    @ActiveUserId() userId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() updateExpenseCategoryDto: UpdateExpenseCategoryDto,
  ) {
    return this.categoriesService.update(
      userId,
      categoryId,
      updateExpenseCategoryDto,
    );
  }
}
