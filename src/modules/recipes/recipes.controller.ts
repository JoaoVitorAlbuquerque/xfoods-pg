import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { RecipesService } from './services/recipes.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { ListRecipesDto } from './dto/list-recipes.dto';

@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get()
  findAll(@ActiveUserId() userId: string, @Query() filters: ListRecipesDto) {
    return this.recipesService.findAllByUserId(userId, filters);
  }

  // As rotas fixas vêm antes de `:recipeId`, senão "cost-report" seria lido
  // como um id.

  /** Custo direto de todos os pratos com ficha ativa. */
  @Get('cost-report')
  getCostReport(@ActiveUserId() userId: string) {
    return this.recipesService.getCostReport(userId);
  }

  /** Pratos vendáveis sem ficha ativa — onde o estoque não vai baixar. */
  @Get('missing')
  findMissing(@ActiveUserId() userId: string) {
    return this.recipesService.findProductsWithoutRecipe(userId);
  }

  /** Ficha que vale para novas vendas do prato, já com o custo calculado. */
  @Get('product/:productId/active')
  findActiveByProduct(
    @ActiveUserId() userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.recipesService.findActiveByProduct(userId, productId);
  }

  @Get(':recipeId')
  findOne(
    @ActiveUserId() userId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
  ) {
    return this.recipesService.findOne(userId, recipeId);
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createRecipeDto: CreateRecipeDto,
  ) {
    return this.recipesService.create(userId, createRecipeDto);
  }

  @Put(':recipeId')
  update(
    @ActiveUserId() userId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
    @Body() updateRecipeDto: UpdateRecipeDto,
  ) {
    return this.recipesService.update(userId, recipeId, updateRecipeDto);
  }

  /** Copia esta ficha numa versão nova e inativa. A original fica intacta. */
  @Post(':recipeId/new-version')
  newVersion(
    @ActiveUserId() userId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
    @Body() updateRecipeDto: UpdateRecipeDto,
  ) {
    return this.recipesService.newVersion(userId, recipeId, updateRecipeDto);
  }

  /** Passa a valer para novas vendas; desativa as outras versões do prato. */
  @Patch(':recipeId/activate')
  activate(
    @ActiveUserId() userId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
  ) {
    return this.recipesService.activate(userId, recipeId);
  }

  @Patch(':recipeId/deactivate')
  deactivate(
    @ActiveUserId() userId: string,
    @Param('recipeId', ParseUUIDPipe) recipeId: string,
  ) {
    return this.recipesService.deactivate(userId, recipeId);
  }
}
