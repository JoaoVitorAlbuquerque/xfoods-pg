import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Cadastro publico.
 *
 * `role` NAO entra aqui de proposito: uma rota publica que aceita o papel
 * informado pelo cliente deixaria qualquer um se cadastrar como OWNER de
 * propria conta. Quem se cadastra abre o proprio estabelecimento e recebe o
 * padrao do schema; promover alguem e operacao autenticada.
 */
export class SignUpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(180)
  email: string;

  /**
   * O minimo de 8 e o mesmo do sign-in — se divergissem, daria para cadastrar
   * uma senha que depois nao passa no login.
   *
   * O maximo existe porque o bcrypt ignora tudo alem de 72 bytes: sem o limite,
   * duas senhas longas com o mesmo prefixo abririam a mesma conta.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
