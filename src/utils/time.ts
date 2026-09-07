import type { DateLike } from '../types'

export type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface TimeScale {
    unit: TimeUnit
    step: number
    /** Durée approximative d'un pas, utilisée seulement pour choisir l'échelle. */
    approxMs: number
}

export interface MinorTick {
    key: string
    x: number
    width: number
    label: string
    date: Date
    weekend: boolean
    today: boolean
}

export interface MajorTick {
    key: string
    left: number
    width: number
    label: string
}

/** Échelle imposée à l'axe, en remplacement du choix automatique. */
export interface ForcedTimeScale {
    unit: TimeUnit
    step?: number
}

export interface TimeAxis {
    scale: TimeScale
    minor: MinorTick[]
    major: MajorTick[]
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30.436875 * DAY
const YEAR = 365.2425 * DAY

const SCALES: TimeScale[] = [
    { unit: 'second', step: 1, approxMs: SECOND },
    { unit: 'second', step: 5, approxMs: 5 * SECOND },
    { unit: 'second', step: 15, approxMs: 15 * SECOND },
    { unit: 'second', step: 30, approxMs: 30 * SECOND },
    { unit: 'minute', step: 1, approxMs: MINUTE },
    { unit: 'minute', step: 5, approxMs: 5 * MINUTE },
    { unit: 'minute', step: 15, approxMs: 15 * MINUTE },
    { unit: 'minute', step: 30, approxMs: 30 * MINUTE },
    { unit: 'hour', step: 1, approxMs: HOUR },
    { unit: 'hour', step: 3, approxMs: 3 * HOUR },
    { unit: 'hour', step: 6, approxMs: 6 * HOUR },
    { unit: 'hour', step: 12, approxMs: 12 * HOUR },
    { unit: 'day', step: 1, approxMs: DAY },
    { unit: 'week', step: 1, approxMs: WEEK },
    { unit: 'month', step: 1, approxMs: MONTH },
    { unit: 'month', step: 3, approxMs: 3 * MONTH },
    { unit: 'year', step: 1, approxMs: YEAR },
    { unit: 'year', step: 5, approxMs: 5 * YEAR },
    { unit: 'year', step: 10, approxMs: 10 * YEAR },
]

const MAJOR_UNIT: Record<TimeUnit, TimeUnit | null> = {
    second: 'hour',
    minute: 'day',
    hour: 'day',
    day: 'month',
    week: 'month',
    month: 'year',
    year: null,
}

export function toMs(value: DateLike | undefined | null): number {
    if (value === undefined || value === null) {
        return NaN
    }
    if (value instanceof Date) {
        return value.getTime()
    }
    if (typeof value === 'number') {
        return value
    }
    // Les dates SQL ("2026-01-31 08:00:00") ne sont pas parsées partout : on les normalise en ISO local.
    const sqlLike = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
    if (sqlLike) {
        return new Date(
            Number(sqlLike[1]),
            Number(sqlLike[2]) - 1,
            Number(sqlLike[3]),
            Number(sqlLike[4]),
            Number(sqlLike[5]),
            Number(sqlLike[6] ?? 0),
        ).getTime()
    }
    return new Date(value).getTime()
}

export function floorDate(date: Date, unit: TimeUnit, step: number, weekStart = 1): Date {
    const d = new Date(date.getTime())
    switch (unit) {
        case 'year': {
            const year = Math.floor(d.getFullYear() / step) * step
            return new Date(year, 0, 1)
        }
        case 'month': {
            const month = Math.floor(d.getMonth() / step) * step
            return new Date(d.getFullYear(), month, 1)
        }
        case 'week': {
            const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
            const diff = (start.getDay() - weekStart + 7) % 7
            start.setDate(start.getDate() - diff)
            return start
        }
        case 'day':
            return new Date(d.getFullYear(), d.getMonth(), d.getDate())
        case 'hour':
            return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(d.getHours() / step) * step)
        case 'minute':
            return new Date(
                d.getFullYear(),
                d.getMonth(),
                d.getDate(),
                d.getHours(),
                Math.floor(d.getMinutes() / step) * step,
            )
        default:
            return new Date(
                d.getFullYear(),
                d.getMonth(),
                d.getDate(),
                d.getHours(),
                d.getMinutes(),
                Math.floor(d.getSeconds() / step) * step,
            )
    }
}

export function addDate(date: Date, unit: TimeUnit, step: number): Date {
    const d = new Date(date.getTime())
    switch (unit) {
        case 'year':
            d.setFullYear(d.getFullYear() + step)
            return d
        case 'month':
            d.setMonth(d.getMonth() + step)
            return d
        case 'week':
            d.setDate(d.getDate() + 7 * step)
            return d
        case 'day':
            d.setDate(d.getDate() + step)
            return d
        case 'hour':
            d.setHours(d.getHours() + step)
            return d
        case 'minute':
            d.setMinutes(d.getMinutes() + step)
            return d
        default:
            d.setSeconds(d.getSeconds() + step)
            return d
    }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function format(date: Date, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
    const key = (locale ?? '') + JSON.stringify(options)
    let formatter = formatterCache.get(key)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, options)
        formatterCache.set(key, formatter)
    }
    return formatter.format(date)
}

function isoWeek(date: Date): number {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
    const firstThursday = new Date(d.getFullYear(), 0, 4)
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7))
    return 1 + Math.round((d.getTime() - firstThursday.getTime()) / WEEK)
}

function minorLabel(date: Date, scale: TimeScale, pxPerTick: number, locale?: string): string {
    switch (scale.unit) {
        case 'second':
            return ':' + String(date.getSeconds()).padStart(2, '0')
        case 'minute':
        case 'hour':
            return format(date, locale, { hour: '2-digit', minute: '2-digit' })
        case 'day':
            return pxPerTick >= 70
                ? format(date, locale, { weekday: 'short', day: 'numeric' })
                : String(date.getDate())
        case 'week':
            return 'S' + isoWeek(date)
        case 'month':
            return format(date, locale, pxPerTick >= 70 ? { month: 'long' } : { month: 'short' })
        default:
            return String(date.getFullYear())
    }
}

function majorLabel(date: Date, unit: TimeUnit, locale?: string): string {
    switch (unit) {
        case 'hour':
            return format(date, locale, { hour: '2-digit', minute: '2-digit' })
        case 'day':
            return format(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })
        case 'month':
            return format(date, locale, { month: 'long', year: 'numeric' })
        default:
            return String(date.getFullYear())
    }
}

export function pickScale(rangeMs: number, width: number, minTickWidth: number): TimeScale {
    const target = rangeMs / Math.max(1, width / minTickWidth)
    return SCALES.find((scale) => scale.approxMs >= target) ?? SCALES[SCALES.length - 1]
}

/**
 * Construit les graduations de l'axe temporel pour la fenêtre affichée.
 * `width` est la largeur en pixels de la zone de contenu (hors colonne des groupes).
 */
export function buildTimeAxis(
    startMs: number,
    endMs: number,
    width: number,
    options: {
        locale?: string
        weekStart?: number
        minTickWidth?: number
        /** Échelle imposée : sinon la plus lisible est choisie d'après la largeur disponible. */
        scale?: ForcedTimeScale | null
    } = {},
): TimeAxis {
    const { locale, weekStart = 1, minTickWidth = 60, scale: forcedScale } = options
    const rangeMs = endMs - startMs

    if (!(rangeMs > 0) || !(width > 0)) {
        return { scale: SCALES[0], minor: [], major: [] }
    }

    const scale: TimeScale = forcedScale
        ? { unit: forcedScale.unit, step: forcedScale.step ?? 1, approxMs: 0 }
        : pickScale(rangeMs, width, minTickWidth)
    const toX = (ms: number) => ((ms - startMs) / rangeMs) * width
    const todayKey = new Date().toDateString()

    const minor: MinorTick[] = []
    let cursor = floorDate(new Date(startMs), scale.unit, scale.step, weekStart)
    let guard = 0
    while (cursor.getTime() < endMs && guard++ < 5000) {
        const next = addDate(cursor, scale.unit, scale.step)
        const rawX = toX(cursor.getTime())
        const rawNextX = toX(next.getTime())
        // Les graduations partiellement visibles sont rognées sur la fenêtre : leur libellé
        // reste ainsi lisible aux deux extrémités de l'axe.
        const x = Math.max(0, rawX)
        const nextX = Math.min(width, rawNextX)
        if (nextX > x) {
            const day = cursor.getDay()
            minor.push({
                key: 'm' + cursor.getTime(),
                x,
                width: nextX - x,
                label: minorLabel(cursor, scale, rawNextX - rawX, locale),
                date: new Date(cursor.getTime()),
                weekend: (scale.unit === 'day' || scale.unit === 'hour') && (day === 0 || day === 6),
                today: scale.unit !== 'month' && scale.unit !== 'year' && cursor.toDateString() === todayKey,
            })
        }
        cursor = next
    }

    const majorUnit = MAJOR_UNIT[scale.unit]
    const major: MajorTick[] = []
    if (majorUnit) {
        let majorCursor = floorDate(new Date(startMs), majorUnit, 1, weekStart)
        guard = 0
        while (majorCursor.getTime() < endMs && guard++ < 5000) {
            const next = addDate(majorCursor, majorUnit, 1)
            const left = Math.max(0, toX(majorCursor.getTime()))
            const right = Math.min(width, toX(next.getTime()))
            if (right > left) {
                major.push({
                    key: 'M' + majorCursor.getTime(),
                    left,
                    width: right - left,
                    label: majorLabel(majorCursor, majorUnit, locale),
                })
            }
            majorCursor = next
        }
    }

    return { scale, minor, major }
}
