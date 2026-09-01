import { IsDefined, IsNotEmpty, IsString } from 'class-validator';

export class ConvertQuantityDto {
  /**
   * Aceita string ou number. Enviar string preserva a precisão decimal —
   * um number em JSON já é float antes de chegar aqui.
   */
  @IsDefined()
  quantity: string | number;

  /** Sigla da unidade de origem, ex.: "KG". */
  @IsString()
  @IsNotEmpty()
  from: string;

  /** Sigla da unidade de destino, ex.: "G". */
  @IsString()
  @IsNotEmpty()
  to: string;
}
