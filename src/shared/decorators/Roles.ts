import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restringe uma rota a determinados papéis.
 *
 * Nenhuma rota existente usa este decorator: na Fase 1 ele entra apenas como
 * mecanismo, para que os endpoints de custo, margem e rentabilidade das fases
 * seguintes já nasçam protegidos. Rota sem `@Roles()` continua aberta a
 * qualquer usuário autenticado, exatamente como hoje.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
