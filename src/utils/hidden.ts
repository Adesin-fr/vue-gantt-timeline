import type { HiddenTimeRange } from '../types'

export interface Interval {
    start: number
    end: number
}

/** Plage récurrente normalisée : bornes en minutes depuis minuit (0 à 1440). */
export interface ParsedHiddenRange {
    startMinutes: number
    endMinutes: number
    days: number[] | null
}

const DAY_MINUTES = 24 * 60
/** Largeur de la fenêtre explorée à chaque pas par `shiftByVisible`. */
const SHIFT_CHUNK_MS = 7 * 24 * 60 * 60 * 1000

function parseClock(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
    if (!match) {
        return null
    }
    const minutes = Number(match[1]) * 60 + Number(match[2])
    return Number(match[2]) < 60 && minutes <= DAY_MINUTES ? minutes : null
}

/** Ignore les plages invalides ou vides (début = fin). */
export function parseHiddenRanges(ranges: HiddenTimeRange[] | undefined | null): ParsedHiddenRange[] {
    const parsed: ParsedHiddenRange[] = []
    for (const range of ranges ?? []) {
        const startMinutes = parseClock(range.start)
        const endMinutes = parseClock(range.end)
        if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
            continue
        }
        parsed.push({ startMinutes, endMinutes, days: range.days?.length ? range.days : null })
    }
    return parsed
}

/**
 * Intervalles masqués qui rencontrent [fromMs, toMs], triés, fusionnés et non rognés.
 * Une plage qui passe minuit (début > fin) appartient au jour où elle commence.
 */
export function hiddenIntervalsBetween(ranges: ParsedHiddenRange[], fromMs: number, toMs: number): Interval[] {
    if (ranges.length === 0 || !(toMs > fromMs)) {
        return []
    }

    const found: Interval[] = []
    const day = new Date(fromMs)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - 1)

    for (let guard = 0; day.getTime() < toMs && guard < 20000; guard++) {
        const year = day.getFullYear()
        const month = day.getMonth()
        const date = day.getDate()
        const weekday = day.getDay()

        for (const range of ranges) {
            if (range.days && !range.days.includes(weekday)) {
                continue
            }
            const start = new Date(year, month, date, 0, range.startMinutes).getTime()
            const end =
                range.endMinutes > range.startMinutes
                    ? new Date(year, month, date, 0, range.endMinutes).getTime()
                    : new Date(year, month, date + 1, 0, range.endMinutes).getTime()
            if (end > fromMs && start < toMs) {
                found.push({ start, end })
            }
        }
        day.setDate(date + 1)
    }

    found.sort((a, b) => a.start - b.start)

    const merged: Interval[] = []
    for (const interval of found) {
        const last = merged[merged.length - 1]
        if (last && interval.start <= last.end) {
            last.end = Math.max(last.end, interval.end)
        } else {
            merged.push({ ...interval })
        }
    }
    return merged
}

/**
 * Projette le temps réel sur un axe « visible » d'où les plages masquées ont été retirées,
 * pour une fenêtre [startMs, endMs] donnée. Hors de la fenêtre, l'axe reste linéaire.
 */
export class VisibleTimeline {
    /** Intervalles masqués rognés sur la fenêtre. */
    readonly intervals: Interval[]
    /** Durée visible de la fenêtre, en millisecondes. */
    readonly span: number
    /** `hiddenBefore[i]` : durée masquée cumulée avant l'intervalle i. */
    private readonly hiddenBefore: number[] = [0]

    constructor(
        ranges: ParsedHiddenRange[],
        readonly startMs: number,
        readonly endMs: number,
    ) {
        this.intervals = hiddenIntervalsBetween(ranges, startMs, endMs)
            .map((interval) => ({ start: Math.max(interval.start, startMs), end: Math.min(interval.end, endMs) }))
            .filter((interval) => interval.end > interval.start)

        for (const interval of this.intervals) {
            this.hiddenBefore.push(this.hiddenBefore[this.hiddenBefore.length - 1] + interval.end - interval.start)
        }
        this.span = Math.max(1, endMs - startMs - this.hiddenBefore[this.intervals.length])
    }

    get hasHidden(): boolean {
        return this.intervals.length > 0
    }

    /** Index du premier intervalle qui se termine après `ms`. */
    private firstEndingAfter(ms: number): number {
        let low = 0
        let high = this.intervals.length
        while (low < high) {
            const mid = (low + high) >> 1
            if (this.intervals[mid].end <= ms) {
                low = mid + 1
            } else {
                high = mid
            }
        }
        return low
    }

    /** Durée visible écoulée entre le début de la fenêtre et `ms`. */
    offset(ms: number): number {
        if (ms <= this.startMs) {
            return ms - this.startMs
        }
        if (ms >= this.endMs) {
            return this.span + (ms - this.endMs)
        }
        const index = this.firstEndingAfter(ms)
        const interval = this.intervals[index]
        const partial = interval && interval.start < ms ? ms - interval.start : 0
        return ms - this.startMs - this.hiddenBefore[index] - partial
    }

    /** Opération inverse d'`offset` ; un décalage tombant sur une coupure donne le début de la plage masquée. */
    toTime(offset: number): number {
        if (offset <= 0) {
            return this.startMs + offset
        }
        if (offset >= this.span) {
            return this.endMs + (offset - this.span)
        }
        let low = 0
        let high = this.intervals.length
        while (low < high) {
            const mid = (low + high) >> 1
            const visibleStart = this.intervals[mid].start - this.startMs - this.hiddenBefore[mid]
            if (visibleStart < offset) {
                low = mid + 1
            } else {
                high = mid
            }
        }
        return this.startMs + offset + this.hiddenBefore[low]
    }

    isHidden(ms: number): boolean {
        const interval = this.intervals[this.firstEndingAfter(ms)]
        return !!interval && interval.start <= ms
    }
}

/** Durée visible (plages masquées déduites) entre deux instants. */
export function visibleDuration(ranges: ParsedHiddenRange[], startMs: number, endMs: number): number {
    return endMs > startMs ? new VisibleTimeline(ranges, startMs, endMs).span : 0
}

/**
 * Avance (ou recule si `delta` < 0) de `delta` millisecondes de temps visible à partir de `fromMs`,
 * en sautant les plages masquées.
 */
export function shiftByVisible(ranges: ParsedHiddenRange[], fromMs: number, delta: number): number {
    if (ranges.length === 0 || delta === 0 || !Number.isFinite(delta)) {
        return fromMs + delta
    }

    const forward = delta > 0
    let cursor = fromMs
    let remaining = Math.abs(delta)

    for (let guard = 0; remaining > 0 && guard < 2000; guard++) {
        if (forward) {
            const intervals = hiddenIntervalsBetween(ranges, cursor, cursor + SHIFT_CHUNK_MS)
            const containing = intervals.find((interval) => interval.start <= cursor && cursor < interval.end)
            if (containing) {
                cursor = containing.end
                continue
            }
            const next = intervals.find((interval) => interval.start > cursor)
            const limit = next ? next.start : cursor + SHIFT_CHUNK_MS
            if (remaining <= limit - cursor) {
                return cursor + remaining
            }
            remaining -= limit - cursor
            cursor = limit
        } else {
            const intervals = hiddenIntervalsBetween(ranges, cursor - SHIFT_CHUNK_MS, cursor)
            const containing = intervals.find((interval) => interval.start < cursor && cursor <= interval.end)
            if (containing) {
                cursor = containing.start
                continue
            }
            const previous = [...intervals].reverse().find((interval) => interval.end < cursor)
            const limit = previous ? previous.end : cursor - SHIFT_CHUNK_MS
            if (remaining <= cursor - limit) {
                return cursor - remaining
            }
            remaining -= cursor - limit
            cursor = limit
        }
    }

    return cursor
}
