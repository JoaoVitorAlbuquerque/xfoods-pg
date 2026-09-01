import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, map } from 'rxjs';

/**
 * O Prisma devolve colunas Decimal como instâncias de `Prisma.Decimal`, que o
 * serializador do Nest transforma em string: `"9.9"` no lugar de `9.9`.
 *
 * O frontend consome esses campos como number — `item.quantity * item.product.price`
 * no Financial, `sum + total` no cálculo mensal. Uma string ali não lança erro:
 * ela silenciosamente concatena ou vira NaN, e o total aparece errado sem nenhum
 * sinal na tela.
 *
 * Este interceptor converte Decimal em number na borda HTTP, mantendo o JSON
 * idêntico ao de antes da migração. A precisão decimal continua garantida onde
 * de fato importa: nas colunas do banco e nos cálculos feitos no servidor.
 */
@Injectable()
export class DecimalSerializerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => serializeDecimals(data)));
  }
}

export function serializeDecimals(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Prisma.Decimal.isDecimal(value)) {
    return (value as Prisma.Decimal).toNumber();
  }

  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeDecimals(item));
  }

  // Apenas objetos simples são percorridos. Instâncias de classe passam
  // intactas para não desmontar o que a rota devolveu de propósito.
  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    result[key] = serializeDecimals(item);
  }

  return result;
}
