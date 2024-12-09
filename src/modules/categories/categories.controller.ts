import {
  Controller,
  Get,
  Post,
  Body,
  // Patch,
  Param,
  Delete,
  Put,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { CategoriesService } from './services/categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(userId, createCategoryDto);
  }

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.categoriesService.findAllByUserId(userId);
  }

  // @Get(':id')
  // findOne(, @Param('id') id: string) {
  //   return this.categoriesService.findOne(, id);
  // }

  @Put(':categoryId')
  async update(
    @ActiveUserId() userId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(userId, categoryId, updateCategoryDto);
  }

  @Delete(':categoryId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.categoriesService.remove(userId, categoryId);
  }
}
