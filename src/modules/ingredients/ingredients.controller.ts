import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  ParseUUIDPipe,
  Put,
  HttpCode,
} from '@nestjs/common';
import { IngredientsService } from './services/ingredients.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';

@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createIngredientDto: CreateIngredientDto,
  ) {
    return this.ingredientsService.create(userId, createIngredientDto);
  }

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.ingredientsService.findAllByUserId(userId);
  }

  // @Get(':ingredientId')
  // findOne(@Param('ingredientId') ingredientId: string) {
  //   return this.ingredientsService.findOne(ingredientId);
  // }

  @Put(':ingredientId')
  async update(
    @ActiveUserId() userId: string,
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
    @Body() updateIngredientDto: UpdateIngredientDto,
  ) {
    return this.ingredientsService.update(
      userId,
      ingredientId,
      updateIngredientDto,
    );
  }

  @Delete(':ingredientId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
  ) {
    return this.ingredientsService.remove(userId, ingredientId);
  }
}
