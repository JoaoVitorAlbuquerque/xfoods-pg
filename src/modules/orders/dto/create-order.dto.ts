import { OrderType, SizeType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateOrderDto {
  @IsNumber()
  @IsNotEmpty()
  table: number;

  // @IsString()
  // @IsNotEmpty()
  // @IsEnum(OrderType)
  // status: OrderType;

  @IsString()
  @IsOptional()
  description: string;

  @IsEnum(OrderType)
  @IsOptional()
  status: OrderType;

  @IsBoolean()
  @IsOptional()
  paid: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductOrderDto)
  products: ProductOrderDto[];
}

export class ProductOrderDto {
  @IsString()
  @IsUUID()
  productId: string;

  @IsEnum(SizeType)
  size: SizeType;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;
}
