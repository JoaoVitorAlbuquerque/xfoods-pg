import { Injectable } from '@nestjs/common';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductsRepository } from 'src/shared/database/repositories/products.repositories';
import { ValidateProductOwnershipService } from '../services/validate-product-ownership.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepo: ProductsRepository,
    private readonly validateProductOwnershipService: ValidateProductOwnershipService,
  ) {}

  create(userId: string, createProductDto: CreateProductDto) {
    const {
      ingredientIds,
      name,
      categoryId,
      deleted,
      description,
      imagePath,
      price,
    } = createProductDto;

    const parsedIngredientIds = ingredientIds.map((id) =>
      id
        .trim()
        .replace(/^\["|"\]$/g, '')
        .replace(/^"|"$/g, '')
        .replace(/^\"|\"$/g, '')
        .trim(),
    );

    return this.productsRepo.create({
      data: {
        userId,
        name,
        description,
        imagePath,
        price,
        deleted,
        categoryId,
        ingredients: {
          create: parsedIngredientIds.map((ingredientId) => ({
            ingredient: {
              connect: { id: ingredientId },
            },
          })),
        },
      },
      include: {
        ingredients: {
          include: {
            ingredient: true,
          },
        },
      },
    });
  }

  findAll(userId: string) {
    return this.productsRepo.findMany({
      where: { userId, deleted: false },
      select: {
        id: true,
        userId: true,
        name: true,
        imagePath: true,
        description: true,
        price: true,
        deleted: true,
        category: true,
        ingredients: {
          select: {
            ingredient: true,
          },
        },
      },
    });
  }

  findProductsByCategory(userId: string, categoryId: string) {
    return this.productsRepo.findMany({
      where: { userId, categoryId, deleted: false },
      include: {
        ingredients: {
          include: {
            ingredient: true,
          },
        },
        category: true,
      },
    });
  }

  async softDeleted(
    userId: string,
    productId: string,
    updateProductDto: UpdateProductDto,
  ) {
    await this.validateProductOwnershipService.validate(userId, productId);

    const { deleted = true } = updateProductDto;

    return this.productsRepo.update({
      where: { id: productId },
      data: {
        deleted,
      },
    });
  }

  // async update(
  //   userId: string,
  //   productId: string,
  //   updateProductDto: UpdateProductDto,
  // ) {
  //   await this.validateProductOwnershipService.validate(userId, productId);

  //   await this.productsRepo.update({
  //     where: { id: productId },
  //     data: {

  //     },
  //   });
  // }

  async remove(userId: string, productId: string) {
    await this.validateProductOwnershipService.validate(userId, productId);

    // Era `delete` físico. Um produto já vendido é referenciado por
    // `product_order`, então o delete ou falhava por chave estrangeira ou, se
    // um dia ganhasse cascade, apagaria o histórico de vendas junto. A rota
    // continua existindo e respondendo 204 — o que mudou é que ela agora faz o
    // mesmo soft delete de `PATCH /products/:productId/soft-delete`.
    await this.productsRepo.update({
      where: { id: productId },
      data: { deleted: true },
    });

    return null;
  }
}
