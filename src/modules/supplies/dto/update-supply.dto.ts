import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateSupplyDto } from './create-supply.dto';

/**
 * `baseUnit` e o saldo de abertura ficam de fora. Trocar a unidade base
 * reinterpretaria todo saldo e toda movimentação já gravada — 10 deixaria de
 * significar 10 gramas e passaria a significar 10 quilos, sem nenhum registro
 * disso. O saldo só muda por movimentação.
 */
export class UpdateSupplyDto extends PartialType(
  OmitType(CreateSupplyDto, [
    'baseUnit',
    'initialStock',
    'initialStockUnit',
    'initialUnitCost',
  ] as const),
) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
