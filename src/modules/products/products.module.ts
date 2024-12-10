import * as path from 'node:path';

import { Module } from '@nestjs/common';
import { ProductsService } from './services/products.service';
import { ProductsController } from './products.controller';

import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ValidateProductOwnershipService } from './services/validate-product-ownership.service';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination(req, file, callback) {
          callback(null, path.resolve(__dirname, '..', '..', '..', 'uploads'));
        },
        filename: (req, file, callback) => {
          callback(null, `${Date.now()}-${file.originalname}`);
        },
      }),
    }),
  ],
  controllers: [ProductsController],
  providers: [ProductsService, ValidateProductOwnershipService],
  exports: [ValidateProductOwnershipService],
})
export class ProductsModule {}
