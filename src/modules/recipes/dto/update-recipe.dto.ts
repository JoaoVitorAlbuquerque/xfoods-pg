import { OmitType, PartialType } from '@nestjs/mapped-types';

import { CreateRecipeDto } from './create-recipe.dto';

/**
 * `productId` fica de fora: mover uma ficha de um prato para outro
 * reinterpretaria o histórico de custo já calculado com ela. O caminho é criar
 * uma ficha no prato certo.
 *
 * `items` informado substitui a lista inteira; ausente mantém a atual.
 */
export class UpdateRecipeDto extends PartialType(
  OmitType(CreateRecipeDto, ['productId', 'activate'] as const),
) {}
