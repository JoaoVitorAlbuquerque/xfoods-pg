import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AllocationPeriod,
  ExpenseRecurrence,
  Prisma,
} from '@prisma/client';

/** A regra de uma despesa, sem nada que dependa do banco. */
export type ExpenseRule = {
  amount: Prisma.Decimal | string | number;
  recurrence: ExpenseRecurrence;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  deactivatedAt: Date | null;
};

export type ExpenseOccurrence = {
  /** Data de competência, sempre meia-noite UTC. */
  competenceDate: Date;
  amount: Prisma.Decimal;
};

export type DateWindow = { from: Date; to: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Teto de expansão. Uma despesa diária numa janela de trinta anos geraria mais
 * de dez mil linhas e travaria a resposta; melhor recusar com uma mensagem
 * clara do que devolver depois de um minuto.
 */
const MAX_OCCURRENCES = 10000;

/**
 * Transforma a regra de uma despesa nas competências que ela gera numa janela.
 *
 * Toda data aqui é data pura em UTC. Competência é mês, não instante: guardar
 * "01/03" como meia-noite local faria a mesma despesa cair em fevereiro para
 * quem está a oeste de Greenwich, e o custo do mês mudaria com o fuso do
 * servidor.
 *
 * Sem banco e sem Nest de propósito: é a regra que decide de qual mês cada
 * despesa é, e precisa ser verificável sozinha.
 */
@Injectable()
export class ExpenseRecurrenceService {
  /** Meia-noite UTC do dia desta data. */
  toDateOnly(date: Date | string): Date {
    const parsed = date instanceof Date ? date : new Date(date);

    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
  }

  /**
   * Até quando a regra vale. Nulo significa "sem data de corte".
   *
   * `endDate` é a data planejada; `deactivatedAt` é o desligamento sem data.
   * Vale a mais cedo das duas — desativar é parar de repetir daqui pra frente,
   * e não apagar as competências que já passaram.
   *
   * Nulo numa despesa inativa é caso à parte, tratado em `expand`: sem data de
   * corte não dá para afirmar em que competência ela parou.
   */
  effectiveEnd(rule: ExpenseRule): Date | null {
    const bounds = [rule.endDate, rule.deactivatedAt]
      .filter((date): date is Date => Boolean(date))
      .map((date) => this.toDateOnly(date));

    if (bounds.length === 0) {
      return null;
    }

    return bounds.reduce((earliest, date) =>
      date < earliest ? date : earliest,
    );
  }

  /**
   * Competências que a regra gera dentro da janela.
   *
   * A janela é inclusiva nas duas pontas — um relatório de "março" vai de
   * 01/03 a 31/03, e a despesa do dia 31 precisa entrar.
   */
  expand(rule: ExpenseRule, window: DateWindow): ExpenseOccurrence[] {
    const start = this.toDateOnly(rule.startDate);
    const from = this.toDateOnly(window.from);
    const to = this.toDateOnly(window.to);

    if (to < from) {
      throw new BadRequestException(
        'The end of the period must not be earlier than its start.',
      );
    }

    const end = this.effectiveEnd(rule);

    // Inativa e sem data de corte: não dá para dizer em que competência ela
    // parou, então não produz nada em vez de produzir para sempre. O serviço
    // carimba `deactivatedAt` ao desativar, então isto é trava defensiva.
    if (!rule.active && end === null) {
      return [];
    }

    // O último dia que ainda pode gerar competência.
    const limit = end !== null && end < to ? end : to;

    if (limit < start) {
      return [];
    }

    const amount = new Prisma.Decimal(rule.amount);
    const dates = this.datesFor(rule.recurrence, start, from, limit);

    return dates.map((competenceDate) => ({ competenceDate, amount }));
  }

  /**
   * Quantos períodos de referência a janela encosta.
   *
   * É o que faz uma estimativa mensal de 3.000 unidades virar 9.000 num
   * relatório de trimestre: sem isso o custo por unidade triplicaria só porque
   * alguém abriu uma janela maior.
   *
   * Conta períodos TOCADOS, não completos — quem pede 10 a 20 de março está
   * olhando um mês, ainda que parcial.
   */
  referencePeriodsIn(window: DateWindow, period: AllocationPeriod): number {
    const from = this.toDateOnly(window.from);
    const to = this.toDateOnly(window.to);

    if (to < from) {
      throw new BadRequestException(
        'The end of the period must not be earlier than its start.',
      );
    }

    if (period === AllocationPeriod.DAILY) {
      return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    }

    if (period === AllocationPeriod.WEEKLY) {
      const firstMonday = this.mondayOf(from);
      const lastMonday = this.mondayOf(to);

      return (
        Math.round((lastMonday.getTime() - firstMonday.getTime()) / DAY_MS / 7) +
        1
      );
    }

    if (period === AllocationPeriod.MONTHLY) {
      return this.monthsBetween(from, to) + 1;
    }

    return to.getUTCFullYear() - from.getUTCFullYear() + 1;
  }

  /** Primeiro e último dia do mês desta data. */
  monthWindow(reference: Date = new Date()): DateWindow {
    const year = reference.getUTCFullYear();
    const month = reference.getUTCMonth();

    return {
      from: new Date(Date.UTC(year, month, 1)),
      to: new Date(Date.UTC(year, month + 1, 0)),
    };
  }

  // ---------------------------------------------------------------------------

  private datesFor(
    recurrence: ExpenseRecurrence,
    start: Date,
    from: Date,
    limit: Date,
  ): Date[] {
    if (recurrence === ExpenseRecurrence.ONCE) {
      // Despesa avulsa acontece uma vez, na data dela. `endDate` não a repete
      // nem a antecipa, então só o recorte da janela importa.
      return start >= from && start <= limit ? [start] : [];
    }

    const dates: Date[] = [];

    // Começa do primeiro índice que já cai dentro da janela. Iterar desde a
    // data inicial faria uma despesa diária de 2020 percorrer dois mil dias
    // antes de gerar a primeira linha útil.
    let index = this.firstIndexAtOrAfter(recurrence, start, from);

    for (;;) {
      const date = this.occurrenceAt(recurrence, start, index);

      if (date > limit) {
        break;
      }

      if (date >= from) {
        dates.push(date);

        if (dates.length > MAX_OCCURRENCES) {
          throw new BadRequestException(
            `This period expands to more than ${MAX_OCCURRENCES} occurrences ` +
              `for a ${recurrence} expense. Narrow the period.`,
          );
        }
      }

      index += 1;
    }

    return dates;
  }

  private occurrenceAt(
    recurrence: ExpenseRecurrence,
    start: Date,
    index: number,
  ): Date {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth();
    const day = start.getUTCDate();

    if (recurrence === ExpenseRecurrence.DAILY) {
      return new Date(start.getTime() + index * DAY_MS);
    }

    if (recurrence === ExpenseRecurrence.WEEKLY) {
      return new Date(start.getTime() + index * 7 * DAY_MS);
    }

    if (recurrence === ExpenseRecurrence.MONTHLY) {
      return this.clampedDate(year, month + index, day);
    }

    return this.clampedDate(year + index, month, day);
  }

  private firstIndexAtOrAfter(
    recurrence: ExpenseRecurrence,
    start: Date,
    from: Date,
  ): number {
    if (from <= start) {
      return 0;
    }

    if (recurrence === ExpenseRecurrence.DAILY) {
      return Math.floor((from.getTime() - start.getTime()) / DAY_MS);
    }

    if (recurrence === ExpenseRecurrence.WEEKLY) {
      return Math.floor((from.getTime() - start.getTime()) / DAY_MS / 7);
    }

    if (recurrence === ExpenseRecurrence.MONTHLY) {
      // Um a menos por segurança: o dia do mês pode ter sido aparado e cair
      // depois do esperado. O laço descarta o que ficar antes da janela.
      return Math.max(0, this.monthsBetween(start, from) - 1);
    }

    return Math.max(0, from.getUTCFullYear() - start.getUTCFullYear() - 1);
  }

  /**
   * Mesma data no mês seguinte, aparada ao último dia quando ele não existe.
   *
   * Um aluguel que vence em 31 de janeiro vence em 28 de fevereiro e volta a
   * vencer em 31 de março. Somar meses ingenuamente empurraria fevereiro para
   * 3 de março e arrastaria todos os meses seguintes junto.
   */
  private clampedDate(year: number, monthIndex: number, day: number): Date {
    const lastDayOfMonth = new Date(
      Date.UTC(year, monthIndex + 1, 0),
    ).getUTCDate();

    return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDayOfMonth)));
  }

  private monthsBetween(from: Date, to: Date): number {
    return (
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
      (to.getUTCMonth() - from.getUTCMonth())
    );
  }

  /** Segunda-feira da semana desta data. */
  private mondayOf(date: Date): Date {
    const weekday = (date.getUTCDay() + 6) % 7;

    return new Date(date.getTime() - weekday * DAY_MS);
  }
}
