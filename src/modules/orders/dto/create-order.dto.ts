import { OrderType, SizeType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateOrderDto {
  @IsNumber()
  @IsNotEmpty()
  table: number;

  @IsString()
  @IsOptional()
  description: string;

  @IsString()
  @IsOptional()
  leadId: string;

  @IsEnum(OrderType)
  @IsOptional()
  status: OrderType;

  @IsBoolean()
  @IsOptional()
  paid: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  orderIds: string[];

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

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  quantity: number;
}
