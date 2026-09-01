import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { SupplyCategoriesService } from './services/supply-categories.service';
import { CreateSupplyCategoryDto } from './dto/create-supply-category.dto';
import { UpdateSupplyCategoryDto } from './dto/update-supply-category.dto';

@Controller('supply-categories')
export class SupplyCategoriesController {
  constructor(
    private readonly supplyCategoriesService: SupplyCategoriesService,
  ) {}

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.supplyCategoriesService.findAllByUserId(userId);
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createSupplyCategoryDto: CreateSupplyCategoryDto,
  ) {
    return this.supplyCategoriesService.create(userId, createSupplyCategoryDto);
  }

  @Put(':categoryId')
  update(
    @ActiveUserId() userId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() updateSupplyCategoryDto: UpdateSupplyCategoryDto,
  ) {
    return this.supplyCategoriesService.update(
      userId,
      categoryId,
      updateSupplyCategoryDto,
    );
  }

  @Delete(':categoryId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.supplyCategoriesService.remove(userId, categoryId);
  }
}
