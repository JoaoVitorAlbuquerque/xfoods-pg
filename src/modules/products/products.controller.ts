import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  ParseArrayPipe,
  ParseFloatPipe,
  HttpCode,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProductsService } from './services/products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('imagePath'))
  create(
    @ActiveUserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('price', ParseFloatPipe) price: number,
    @Body(
      'ingredientIds',
      new ParseArrayPipe({ items: String, separator: ',', optional: true }),
    )
    ingredientIds: string[],
    @Body()
    createProductDto: Omit<
      CreateProductDto,
      'price' | 'ingredientIds' | 'imagePath'
    >,
  ) {
    const imagePath = file ? file.filename : null;

    return this.productsService.create(userId, {
      ...createProductDto,
      price,
      imagePath,
      ingredientIds: ingredientIds || [],
    });
  }

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.productsService.findAll(userId);
  }

  @Get(':categoryId/categories')
  findProductsByCategory(
    @ActiveUserId() userId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.productsService.findProductsByCategory(userId, categoryId);
  }

  @Patch(':productId/soft-delete')
  update(
    @ActiveUserId() userId: string,
    @Param('productId') productId: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.softDeleted(
      userId,
      productId,
      updateProductDto,
    );
  }

  // @Patch(':productId')
  // update(
  //   @ActiveUserId() userId: string,
  //   @Param('productId') productId: string,
  //   @Body() updateProductDto: UpdateProductDto,
  // ) {
  //   return this.productsService.update(userId, productId, updateProductDto);
  // }

  @Delete(':productId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.productsService.remove(userId, productId);
  }
}
