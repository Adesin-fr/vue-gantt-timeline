<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type {
    DateLike,
    GanttBackgroundEvent,
    GanttDragKind,
    GanttEditable,
    GanttEditableOption,
    GanttGroup,
    GanttGroupEvent,
    GanttItem,
    GanttItemMoveEvent,
    GanttItemPointerEvent,
    GanttItemRenderer,
    GanttPlacedItem,
    GanttRangeChangeEvent,
    GanttRangeChangeReason,
    GanttRow,
    GanttSnap,
} from './types'
import { buildTimeAxis, toMs } from './utils/time'
import { stackItems } from './utils/stack'

const props = withDefaults(
    defineProps<{
        /** Lignes du planning. */
        groups: GanttGroup[]
        /** Blocs à afficher. Ceux hors de la fenêtre [start, end] ne sont pas rendus. */
        items: GanttItem[]
        /** Début de la fenêtre affichée. */
        start: DateLike
        /** Fin de la fenêtre affichée. */
        end: DateLike
        /** Largeur de la colonne des libellés de groupes, en pixels. */
        groupWidth?: number
        /** Hauteur d'une ligne virtuelle d'empilement. */
        laneHeight?: number
        /** Espace vertical entre deux lignes virtuelles. */
        laneGap?: number
        /** Marge verticale en haut et en bas d'un groupe. */
        rowPadding?: number
        /** Hauteur minimale d'un groupe, même vide. */
        minRowHeight?: number
        /** Largeur minimale d'un bloc, en pixels. */
        minItemWidth?: number
        /** Écart horizontal minimal (px) en dessous duquel deux blocs sont considérés comme superposés. */
        itemMargin?: number
        /** Empiler les blocs qui se chevauchent (sinon ils sont tous sur la première ligne). */
        stack?: boolean
        /** Autorise le déplacement des blocs. */
        editable?: GanttEditableOption
        /** Arrondi appliqué pendant un déplacement : millisecondes ou fonction. */
        snap?: GanttSnap
        /** Durée minimale d'un bloc lors d'un redimensionnement, en millisecondes. */
        minDuration?: number
        /** Locale utilisée pour l'axe temporel (défaut : celle du navigateur). */
        locale?: string
        /** Premier jour de la semaine (0 = dimanche, 1 = lundi). */
        weekStart?: number
        /** Affiche le trait de l'heure courante. */
        showCurrentTime?: boolean
        /** Rendu HTML alternatif au slot `item`. */
        itemRenderer?: GanttItemRenderer
        /** Tri des blocs d'un même groupe avant empilement. */
        order?: (a: GanttItem, b: GanttItem) => number
        /** Nombre de lignes rendues en plus de part et d'autre de la zone visible. */
        overscan?: number
        /** Largeur minimale d'une graduation de l'axe, en pixels. */
        minTickWidth?: number
        /** Autorise le défilement de la plage de dates au clic-glisser dans le vide. */
        pannable?: boolean
        /** Autorise le zoom au pincement et à la molette + ctrl (cmd sur macOS). */
        zoomable?: boolean
        /** Durée minimale de la fenêtre affichée au zoom, en millisecondes. */
        zoomMin?: number
        /** Durée maximale de la fenêtre affichée au zoom, en millisecondes. */
        zoomMax?: number
        /** Borne à gauche de laquelle la fenêtre ne peut pas aller. */
        minDate?: DateLike
        /** Borne à droite de laquelle la fenêtre ne peut pas aller. */
        maxDate?: DateLike
    }>(),
    {
        groupWidth: 180,
        laneHeight: 26,
        laneGap: 2,
        rowPadding: 4,
        minRowHeight: 40,
        minItemWidth: 6,
        itemMargin: 2,
        stack: true,
        editable: false,
        snap: 15 * 60 * 1000,
        minDuration: 5 * 60 * 1000,
        locale: undefined,
        weekStart: 1,
        showCurrentTime: true,
        itemRenderer: undefined,
        order: undefined,
        overscan: 3,
        minTickWidth: 60,
        pannable: false,
        zoomable: false,
        zoomMin: 10 * 60 * 1000,
        zoomMax: 5 * 365 * 24 * 60 * 60 * 1000,
        minDate: undefined,
        maxDate: undefined,
    },
)

const emit = defineEmits<{
    /** Émis en continu pendant un déplacement (position provisoire). */
    (e: 'item-drag', payload: GanttItemMoveEvent): void
    /** Émis au relâchement après un déplacement dans le temps et/ou vers un autre groupe. */
    (e: 'item-move', payload: GanttItemMoveEvent): void
    /** Émis au relâchement après un redimensionnement. */
    (e: 'item-resize', payload: GanttItemMoveEvent): void
    (e: 'item-click', payload: GanttItemPointerEvent): void
    (e: 'item-dblclick', payload: GanttItemPointerEvent): void
    (e: 'item-contextmenu', payload: GanttItemPointerEvent): void
    (e: 'background-click', payload: GanttBackgroundEvent): void
    (e: 'background-dblclick', payload: GanttBackgroundEvent): void
    (e: 'group-click', payload: GanttGroupEvent): void
    (e: 'group-dblclick', payload: GanttGroupEvent): void
    /** Nouvelle fenêtre après un déplacement (pan) ou un zoom. */
    (e: 'range-change', payload: GanttRangeChangeEvent): void
    /** Permet `v-model:start` / `v-model:end` quand `pannable` ou `zoomable` est actif. */
    (e: 'update:start', value: Date): void
    (e: 'update:end', value: Date): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const gridEl = ref<HTMLElement | null>(null)

const contentWidth = ref(0)
const viewportHeight = ref(0)
const scrollTop = ref(0)
const scrollbarWidth = ref(0)
const now = ref(Date.now())

// La fenêtre affichée est pilotée par les props ; le pan et le zoom la font varier
// localement puis la remontent au parent (`range-change`, `update:start` / `update:end`),
// afin de rester utilisables avec ou sans `v-model`.
const innerStart = ref(toMs(props.start))
const innerEnd = ref(toMs(props.end))

watch(
    () => [props.start, props.end] as const,
    ([start, end]) => {
        innerStart.value = toMs(start)
        innerEnd.value = toMs(end)
    },
)

const windowStart = computed(() => innerStart.value)
const windowEnd = computed(() => innerEnd.value)
const rangeMs = computed(() => Math.max(1, windowEnd.value - windowStart.value))
const pxPerMs = computed(() => contentWidth.value / rangeMs.value)

const timeToX = (ms: number) => (ms - windowStart.value) * pxPerMs.value
const xToTime = (x: number) => windowStart.value + (pxPerMs.value > 0 ? x / pxPerMs.value : 0)

/* ------------------------------------------------------------------ édition */

interface DragState {
    id: string
    item: GanttItem
    kind: GanttDragKind
    handle: 'body' | 'start' | 'end'
    group: string | number
    start: number
    end: number
    origGroup: string | number
    origStart: number
    origEnd: number
    pointerX: number
    pointerY: number
    moved: boolean
    updateGroup: boolean
}

const drag = ref<DragState | null>(null)
const suppressClick = ref(false)

function normalizeEditable(value: GanttEditableOption | undefined, fallback: GanttEditable): GanttEditable {
    if (value === undefined) {
        return fallback
    }
    if (typeof value === 'boolean') {
        return { updateTime: value, updateGroup: value }
    }
    return {
        updateTime: value.updateTime ?? fallback.updateTime,
        updateGroup: value.updateGroup ?? fallback.updateGroup,
    }
}

const baseEditable = computed(() => normalizeEditable(props.editable, { updateTime: false, updateGroup: false }))

function itemEditable(item: GanttItem): GanttEditable {
    if (item.type === 'background') {
        return { updateTime: false, updateGroup: false }
    }
    return normalizeEditable(item.editable, baseEditable.value)
}

/* ------------------------------------------------------------------- calcul */

const rows = computed<GanttRow[]>(() => {
    const width = contentWidth.value
    const ws = windowStart.value
    const we = windowEnd.value
    const state = drag.value

    const buckets = new Map<string, { range: GanttPlacedItem[]; background: GanttPlacedItem[] }>()
    for (const group of props.groups) {
        buckets.set(String(group.id), { range: [], background: [] })
    }

    if (width > 0 && we > ws) {
        for (const item of props.items) {
            const dragged = state !== null && String(item.id) === state.id
            const bucket = buckets.get(String(dragged ? state!.group : item.group))
            if (!bucket) {
                continue
            }

            const startMs = dragged ? state!.start : toMs(item.start)
            let endMs = dragged ? state!.end : toMs(item.end ?? item.start)
            if (!Number.isFinite(startMs)) {
                continue
            }
            if (!Number.isFinite(endMs) || endMs < startMs) {
                endMs = startMs
            }

            // Hors de la fenêtre affichée : le bloc n'est tout simplement pas rendu.
            if (endMs < ws || startMs > we) {
                continue
            }

            const rawLeft = timeToX(startMs)
            const rawRight = timeToX(endMs)
            const left = Math.max(0, rawLeft)
            const right = Math.min(width, Math.max(rawRight, rawLeft + props.minItemWidth))

            const placed: GanttPlacedItem = {
                item,
                lane: 0,
                left,
                width: Math.max(props.minItemWidth, right - left),
                startMs,
                endMs,
                clippedStart: rawLeft < -0.5,
                clippedEnd: rawRight > width + 0.5,
                dragging: dragged,
            }

            if (item.type === 'background') {
                bucket.background.push(placed)
            } else {
                bucket.range.push(placed)
            }
        }
    }

    const result: GanttRow[] = []
    let top = 0

    for (const group of props.groups) {
        const bucket = buckets.get(String(group.id))!
        const items = bucket.range

        if (props.order) {
            items.sort((a, b) => props.order!(a.item, b.item))
        }

        const lanes = props.stack ? stackItems(items, props.itemMargin) : Math.min(1, items.length)
        const contentHeight = lanes * props.laneHeight + Math.max(0, lanes - 1) * props.laneGap
        const height = Math.max(
            props.minRowHeight,
            group.minHeight ?? 0,
            contentHeight + props.rowPadding * 2,
        )

        result.push({
            group,
            key: String(group.id),
            top,
            height,
            lanes,
            items,
            background: bucket.background,
        })

        top += height
    }

    return result
})

const totalHeight = computed(() => {
    const last = rows.value[rows.value.length - 1]
    return last ? last.top + last.height : 0
})

/** Fenêtre de rendu vertical : seules les lignes visibles sont montées dans le DOM. */
const visibleRows = computed(() => {
    if (viewportHeight.value === 0) {
        return rows.value
    }
    const overscanPx = props.overscan * props.minRowHeight
    const from = scrollTop.value - overscanPx
    const to = scrollTop.value + viewportHeight.value + overscanPx
    return rows.value.filter((row) => row.top + row.height > from && row.top < to)
})

const axis = computed(() =>
    buildTimeAxis(windowStart.value, windowEnd.value, contentWidth.value, {
        locale: props.locale,
        weekStart: props.weekStart,
        minTickWidth: props.minTickWidth,
    }),
)

// La première graduation est rognée sur le bord gauche : son trait ferait doublon
// avec la bordure de la colonne des groupes.
const gridLines = computed(() => axis.value.minor.filter((tick) => tick.x > 0.5))

const currentTimeX = computed(() => {
    if (!props.showCurrentTime || now.value < windowStart.value || now.value > windowEnd.value) {
        return null
    }
    return timeToX(now.value)
})

function itemStyle(placed: GanttPlacedItem) {
    return {
        left: placed.left + 'px',
        width: placed.width + 'px',
        top: props.rowPadding + placed.lane * (props.laneHeight + props.laneGap) + 'px',
        height: props.laneHeight + 'px',
    }
}

function itemClasses(placed: GanttPlacedItem) {
    const editable = itemEditable(placed.item)
    return [
        placed.item.className,
        {
            'vgt__item--clipped-start': placed.clippedStart,
            'vgt__item--clipped-end': placed.clippedEnd,
            'vgt__item--dragging': placed.dragging,
            'vgt__item--editable': editable.updateTime || editable.updateGroup,
        },
    ]
}

/* ------------------------------------------------------------ déplacements */

function applySnap(ms: number, kind: GanttDragKind): number {
    const snap = props.snap
    if (!snap) {
        return ms
    }
    if (typeof snap === 'number') {
        return snap > 0 ? Math.round(ms / snap) * snap : ms
    }
    const snapped = toMs(snap(new Date(ms), kind))
    return Number.isFinite(snapped) ? snapped : ms
}

function groupAtClientY(clientY: number): GanttGroup | null {
    const body = bodyEl.value
    if (!body) {
        return null
    }
    const y = clientY - body.getBoundingClientRect().top + body.scrollTop
    for (const row of rows.value) {
        if (y >= row.top && y < row.top + row.height) {
            return row.group
        }
    }
    return null
}

function dragPayload(state: DragState): GanttItemMoveEvent {
    return {
        item: state.item,
        kind: state.kind,
        start: new Date(state.start),
        end: new Date(state.end),
        group: state.group,
        previousStart: new Date(state.origStart),
        previousEnd: new Date(state.origEnd),
        previousGroup: state.origGroup,
        groupChanged: String(state.group) !== String(state.origGroup),
    }
}

function onItemPointerDown(event: PointerEvent, placed: GanttPlacedItem, handle: 'body' | 'start' | 'end') {
    if (event.button !== 0 || drag.value) {
        return
    }

    const editable = itemEditable(placed.item)
    if (handle !== 'body' && !editable.updateTime) {
        return
    }
    if (handle === 'body' && !editable.updateTime && !editable.updateGroup) {
        return
    }

    event.preventDefault()

    drag.value = {
        id: String(placed.item.id),
        item: placed.item,
        kind: handle === 'body' ? 'move' : 'resize',
        handle,
        group: placed.item.group,
        start: placed.startMs,
        end: placed.endMs,
        origGroup: placed.item.group,
        origStart: placed.startMs,
        origEnd: placed.endMs,
        pointerX: event.clientX,
        pointerY: event.clientY,
        moved: false,
        updateGroup: handle === 'body' && editable.updateGroup,
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onDragKeyDown)
}

function onPointerMove(event: PointerEvent) {
    const state = drag.value
    if (!state) {
        return
    }

    const dx = event.clientX - state.pointerX
    if (!state.moved && Math.abs(dx) < 3 && Math.abs(event.clientY - state.pointerY) < 3) {
        return
    }
    state.moved = true

    const deltaMs = pxPerMs.value > 0 ? dx / pxPerMs.value : 0
    const editable = itemEditable(state.item)

    if (state.handle === 'body') {
        if (editable.updateTime) {
            const duration = state.origEnd - state.origStart
            const maxStart = Math.max(windowStart.value, windowEnd.value - duration)
            const start = Math.min(Math.max(applySnap(state.origStart + deltaMs, 'move'), windowStart.value), maxStart)
            state.start = start
            state.end = start + duration
        }
        if (state.updateGroup) {
            const group = groupAtClientY(event.clientY)
            if (group) {
                state.group = group.id
            }
        }
    } else if (state.handle === 'start') {
        const start = applySnap(state.origStart + deltaMs, 'resize')
        state.start = Math.min(Math.max(start, windowStart.value), state.origEnd - props.minDuration)
    } else {
        const end = applySnap(state.origEnd + deltaMs, 'resize')
        state.end = Math.max(Math.min(end, windowEnd.value), state.origStart + props.minDuration)
    }

    emit('item-drag', dragPayload(state))
}

function onPointerUp() {
    const state = drag.value
    stopDragListeners()
    drag.value = null

    if (!state || !state.moved) {
        return
    }

    suppressClick.value = true
    window.setTimeout(() => (suppressClick.value = false), 0)

    const payload = dragPayload(state)
    if (state.kind === 'resize') {
        emit('item-resize', payload)
    } else if (payload.start.getTime() !== state.origStart || payload.groupChanged) {
        emit('item-move', payload)
    }
}

function onDragKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        stopDragListeners()
        drag.value = null
    }
}

function stopDragListeners() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('keydown', onDragKeyDown)
}

/* ----------------------------------------------------------- pan et zoom */

interface PanState {
    pointerX: number
    pointerY: number
    startMs: number
    endMs: number
    scrollTop: number
    moved: boolean
}

const pan = ref<PanState | null>(null)

const limitStart = computed(() => (props.minDate === undefined ? null : toMs(props.minDate)))
const limitEnd = computed(() => (props.maxDate === undefined ? null : toMs(props.maxDate)))

/** Applique la nouvelle fenêtre en respectant les bornes, puis la remonte au parent. */
function applyWindow(startMs: number, endMs: number, reason: GanttRangeChangeReason) {
    let span = endMs - startMs
    let start = startMs

    if (reason === 'zoom') {
        span = Math.min(Math.max(span, props.zoomMin), props.zoomMax)
    }

    const min = limitStart.value
    const max = limitEnd.value

    if (min !== null && max !== null && max - min < span) {
        start = min
        span = max - min
    } else {
        if (min !== null && start < min) {
            start = min
        }
        if (max !== null && start + span > max) {
            start = max - span
        }
    }

    const end = start + span

    if (start === innerStart.value && end === innerEnd.value) {
        return
    }

    innerStart.value = start
    innerEnd.value = end

    const payload: GanttRangeChangeEvent = { start: new Date(start), end: new Date(end), reason }
    emit('update:start', payload.start)
    emit('update:end', payload.end)
    emit('range-change', payload)
}

function onBodyPointerDown(event: PointerEvent) {
    if (!props.pannable || event.button !== 0 || drag.value || pan.value) {
        return
    }

    const target = event.target as HTMLElement
    if (target.closest('.vgt__item') || target.closest('.vgt__row-label')) {
        return
    }

    pan.value = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        startMs: windowStart.value,
        endMs: windowEnd.value,
        scrollTop: bodyEl.value?.scrollTop ?? 0,
        moved: false,
    }

    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanEnd)
}

function onPanMove(event: PointerEvent) {
    const state = pan.value
    if (!state) {
        return
    }

    const dx = event.clientX - state.pointerX
    const dy = event.clientY - state.pointerY

    if (!state.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        return
    }
    state.moved = true

    if (pxPerMs.value > 0 && dx !== 0) {
        const deltaMs = dx / pxPerMs.value
        applyWindow(state.startMs - deltaMs, state.endMs - deltaMs, 'pan')
    }

    if (bodyEl.value) {
        bodyEl.value.scrollTop = state.scrollTop - dy
    }
}

function onPanEnd() {
    const state = pan.value
    window.removeEventListener('pointermove', onPanMove)
    window.removeEventListener('pointerup', onPanEnd)
    pan.value = null

    if (state?.moved) {
        // Un glissement ne doit pas être interprété comme un clic dans le vide.
        suppressClick.value = true
        window.setTimeout(() => (suppressClick.value = false), 0)
    }
}

/** Zoome autour du point situé sous le curseur, pour que la date visée ne bouge pas. */
function zoomToSpanAt(clientX: number, span: number) {
    const grid = gridEl.value
    if (!grid || contentWidth.value <= 0) {
        return
    }

    const rect = grid.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - rect.left, 0), contentWidth.value)
    const anchor = xToTime(x)
    const ratio = x / contentWidth.value
    const clamped = Math.min(Math.max(span, props.zoomMin), props.zoomMax)

    applyWindow(anchor - clamped * ratio, anchor + clamped * (1 - ratio), 'zoom')
}

function onWheel(event: WheelEvent) {
    if (!props.zoomable || !(event.ctrlKey || event.metaKey)) {
        return
    }

    event.preventDefault()
    const factor = Math.exp(event.deltaY * 0.002)
    zoomToSpanAt(event.clientX, (windowEnd.value - windowStart.value) * factor)
}

/** Pincement : évènements `gesture*` de WebKit, sinon suivi manuel de deux doigts. */
let gestureSpan = 0
let gestureClientX = 0

function onGestureStart(event: Event) {
    if (!props.zoomable) {
        return
    }
    event.preventDefault()
    gestureSpan = windowEnd.value - windowStart.value
    gestureClientX = (event as unknown as { clientX: number }).clientX
}

function onGestureChange(event: Event) {
    if (!props.zoomable) {
        return
    }
    event.preventDefault()
    const scale = (event as unknown as { scale: number }).scale
    if (scale > 0) {
        zoomToSpanAt(gestureClientX, gestureSpan / scale)
    }
}

let pinchDistance = 0

function touchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.hypot(dx, dy)
}

function onTouchStart(event: TouchEvent) {
    if (!props.zoomable || event.touches.length !== 2) {
        return
    }
    pinchDistance = touchDistance(event.touches)
    gestureSpan = windowEnd.value - windowStart.value
    gestureClientX = (event.touches[0].clientX + event.touches[1].clientX) / 2
}

function onTouchMove(event: TouchEvent) {
    if (!props.zoomable || event.touches.length !== 2 || pinchDistance <= 0) {
        return
    }
    event.preventDefault()
    const scale = touchDistance(event.touches) / pinchDistance
    if (scale > 0) {
        zoomToSpanAt(gestureClientX, gestureSpan / scale)
    }
}

function onTouchEnd() {
    pinchDistance = 0
}

/* -------------------------------------------------------------- évènements */

function onItemClick(event: MouseEvent, placed: GanttPlacedItem, group: GanttGroup) {
    if (suppressClick.value) {
        return
    }
    emit('item-click', { item: placed.item, group, event })
}

function onItemDblClick(event: MouseEvent, placed: GanttPlacedItem, group: GanttGroup) {
    emit('item-dblclick', { item: placed.item, group, event })
}

function onItemContextMenu(event: MouseEvent, placed: GanttPlacedItem, group: GanttGroup) {
    emit('item-contextmenu', { item: placed.item, group, event })
}

function backgroundPayload(event: MouseEvent, group: GanttGroup): GanttBackgroundEvent {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return { group, time: new Date(xToTime(event.clientX - rect.left)), event }
}

function onBackgroundClick(event: MouseEvent, group: GanttGroup) {
    if (suppressClick.value || (event.target as HTMLElement).closest('.vgt__item')) {
        return
    }
    emit('background-click', backgroundPayload(event, group))
}

function onBackgroundDblClick(event: MouseEvent, group: GanttGroup) {
    if ((event.target as HTMLElement).closest('.vgt__item')) {
        return
    }
    emit('background-dblclick', backgroundPayload(event, group))
}

/* ---------------------------------------------------------------- mesures */

function onScroll() {
    scrollTop.value = bodyEl.value?.scrollTop ?? 0
}

function measure() {
    const body = bodyEl.value
    if (body) {
        viewportHeight.value = body.clientHeight
        scrollbarWidth.value = body.offsetWidth - body.clientWidth
    }
    if (gridEl.value) {
        contentWidth.value = gridEl.value.clientWidth
    }
}

const observer = shallowRef<ResizeObserver | null>(null)
let clockTimer = 0

onMounted(() => {
    measure()
    if (typeof ResizeObserver !== 'undefined') {
        observer.value = new ResizeObserver(() => measure())
        if (bodyEl.value) observer.value.observe(bodyEl.value)
        if (gridEl.value) observer.value.observe(gridEl.value)
        if (rootEl.value) observer.value.observe(rootEl.value)
    }
    if (props.showCurrentTime) {
        clockTimer = window.setInterval(() => (now.value = Date.now()), 30_000)
    }

    const body = bodyEl.value
    if (body) {
        // Ces gestes doivent pouvoir être annulés : ils ne peuvent pas être passifs.
        body.addEventListener('wheel', onWheel, { passive: false })
        if ('GestureEvent' in window) {
            body.addEventListener('gesturestart', onGestureStart as EventListener)
            body.addEventListener('gesturechange', onGestureChange as EventListener)
            body.addEventListener('gestureend', onGestureChange as EventListener)
        } else {
            body.addEventListener('touchstart', onTouchStart, { passive: true })
            body.addEventListener('touchmove', onTouchMove, { passive: false })
            body.addEventListener('touchend', onTouchEnd, { passive: true })
        }
    }
})

onBeforeUnmount(() => {
    stopDragListeners()
    onPanEnd()
    observer.value?.disconnect()

    const body = bodyEl.value
    if (body) {
        body.removeEventListener('wheel', onWheel)
        body.removeEventListener('gesturestart', onGestureStart as EventListener)
        body.removeEventListener('gesturechange', onGestureChange as EventListener)
        body.removeEventListener('gestureend', onGestureChange as EventListener)
        body.removeEventListener('touchstart', onTouchStart)
        body.removeEventListener('touchmove', onTouchMove)
        body.removeEventListener('touchend', onTouchEnd)
    }
    if (clockTimer) {
        window.clearInterval(clockTimer)
    }
})

watch(() => props.groups.length, () => requestAnimationFrame(measure))

/** Fait défiler la vue jusqu'au groupe donné. */
function scrollToGroup(groupId: string | number) {
    const row = rows.value.find((candidate) => String(candidate.group.id) === String(groupId))
    if (row && bodyEl.value) {
        bodyEl.value.scrollTop = row.top
    }
}

/** Déplace la fenêtre affichée (utile pour un bouton « aujourd'hui », un zoom, ...). */
function setWindow(start: DateLike, end: DateLike, reason: GanttRangeChangeReason = 'pan') {
    applyWindow(toMs(start), toMs(end), reason)
}

defineExpose({ scrollToGroup, setWindow, rows, axis, timeToX, xToTime })
</script>

<template>
    <div
        ref="rootEl"
        class="vgt"
        :class="{
            'vgt--dragging': !!drag,
            'vgt--pannable': pannable,
            'vgt--panning': !!pan,
            'vgt--gestures': pannable || zoomable,
        }"
    >
        <div class="vgt__header" :style="{ paddingRight: scrollbarWidth + 'px' }">
            <div class="vgt__corner" :style="{ width: groupWidth + 'px' }">
                <slot name="corner" />
            </div>
            <div class="vgt__axis">
                <div class="vgt__axis-major">
                    <div
                        v-for="cell in axis.major"
                        :key="cell.key"
                        class="vgt__axis-major-cell"
                        :style="{ left: cell.left + 'px', width: cell.width + 'px' }"
                    >
                        <span class="vgt__axis-label">{{ cell.label }}</span>
                    </div>
                </div>
                <div class="vgt__axis-minor">
                    <div
                        v-for="tick in axis.minor"
                        :key="tick.key"
                        class="vgt__axis-minor-cell"
                        :class="{ 'vgt__axis-minor-cell--weekend': tick.weekend, 'vgt__axis-minor-cell--today': tick.today }"
                        :style="{ left: tick.x + 'px', width: tick.width + 'px' }"
                    >
                        <span class="vgt__axis-label">{{ tick.label }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div ref="bodyEl" class="vgt__body" @scroll.passive="onScroll" @pointerdown="onBodyPointerDown">
            <div class="vgt__body-inner" :style="{ height: totalHeight + 'px' }">
                <div ref="gridEl" class="vgt__grid" :style="{ left: groupWidth + 'px' }">
                    <div
                        v-for="tick in gridLines"
                        :key="tick.key"
                        class="vgt__grid-line"
                        :class="{ 'vgt__grid-line--weekend': tick.weekend }"
                        :style="{ left: tick.x + 'px', width: tick.width + 'px' }"
                    />
                    <div v-if="currentTimeX !== null" class="vgt__now" :style="{ left: currentTimeX + 'px' }" />
                </div>

                <div
                    v-for="row in visibleRows"
                    :key="row.key"
                    class="vgt__row"
                    :class="[row.group.className, { 'vgt__row--drop-target': drag?.updateGroup && String(drag.group) === row.key }]"
                    :style="{ top: row.top + 'px', height: row.height + 'px' }"
                >
                    <div
                        class="vgt__row-label"
                        :style="[{ width: groupWidth + 'px' }, row.group.style || {}]"
                        @click="emit('group-click', { group: row.group, event: $event })"
                        @dblclick="emit('group-dblclick', { group: row.group, event: $event })"
                    >
                        <slot name="group" :group="row.group" :row="row">
                            <span class="vgt__group-label">{{ row.group.label ?? row.group.id }}</span>
                        </slot>
                    </div>

                    <div
                        class="vgt__row-content"
                        @click="onBackgroundClick($event, row.group)"
                        @dblclick="onBackgroundDblClick($event, row.group)"
                    >
                        <div
                            v-for="placed in row.background"
                            :key="'bg-' + placed.item.id"
                            class="vgt__background"
                            :class="placed.item.className"
                            :style="[
                                { left: placed.left + 'px', width: placed.width + 'px' },
                                placed.item.style || {},
                            ]"
                        />

                        <div
                            v-for="placed in row.items"
                            :key="placed.item.id"
                            class="vgt__item"
                            :class="itemClasses(placed)"
                            :style="[itemStyle(placed), placed.item.style || {}]"
                            :title="placed.item.title"
                            @pointerdown="onItemPointerDown($event, placed, 'body')"
                            @click="onItemClick($event, placed, row.group)"
                            @dblclick="onItemDblClick($event, placed, row.group)"
                            @contextmenu="onItemContextMenu($event, placed, row.group)"
                        >
                            <span
                                v-if="itemEditable(placed.item).updateTime"
                                class="vgt__handle vgt__handle--start"
                                @pointerdown.stop="onItemPointerDown($event, placed, 'start')"
                            />
                            <div class="vgt__item-content">
                                <slot name="item" :item="placed.item" :group="row.group" :placed="placed">
                                    <span v-if="itemRenderer" v-html="itemRenderer(placed.item, row.group)" />
                                    <span v-else>{{ placed.item.content }}</span>
                                </slot>
                            </div>
                            <span
                                v-if="itemEditable(placed.item).updateTime"
                                class="vgt__handle vgt__handle--end"
                                @pointerdown.stop="onItemPointerDown($event, placed, 'end')"
                            />
                        </div>
                    </div>
                </div>

                <div v-if="rows.length === 0" class="vgt__empty">
                    <slot name="empty">Aucun groupe à afficher</slot>
                </div>
            </div>
        </div>
    </div>
</template>

<style>
.vgt {
    --vgt-border: #d9dee5;
    --vgt-border-strong: #b7c0cc;
    --vgt-bg: #ffffff;
    --vgt-header-bg: #f6f8fa;
    --vgt-label-bg: #f6f8fa;
    --vgt-text: #1f2933;
    --vgt-muted: #6b7280;
    --vgt-weekend: rgba(15, 23, 42, 0.04);
    --vgt-item-bg: #d7ecff;
    --vgt-item-border: #7fb5e6;
    --vgt-item-text: #10314f;
    --vgt-now: #ef4444;
    --vgt-row-height: 40px;

    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--vgt-border);
    border-radius: 6px;
    background: var(--vgt-bg);
    color: var(--vgt-text);
    font-size: 12px;
    line-height: 1.3;
    user-select: none;
}

.vgt--dragging {
    cursor: grabbing;
}

.vgt--pannable .vgt__row-content,
.vgt--pannable .vgt__body {
    cursor: grab;
}

.vgt--panning,
.vgt--panning .vgt__row-content,
.vgt--panning .vgt__body {
    cursor: grabbing;
}

/* Laisse le défilement vertical au navigateur, mais garde les gestes horizontaux. */
.vgt--gestures .vgt__body {
    touch-action: pan-y;
}

.vgt__header {
    display: flex;
    flex: none;
    border-bottom: 1px solid var(--vgt-border-strong);
    background: var(--vgt-header-bg);
}

.vgt__corner {
    flex: none;
    border-right: 1px solid var(--vgt-border-strong);
}

.vgt__axis {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.vgt__axis-major,
.vgt__axis-minor {
    position: relative;
    height: 22px;
}

.vgt__axis-major {
    border-bottom: 1px solid var(--vgt-border);
}

.vgt__axis-major-cell,
.vgt__axis-minor-cell {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    box-sizing: border-box;
    border-left: 1px solid var(--vgt-border);
    padding: 0 4px;
    white-space: nowrap;
}

.vgt__axis-major-cell {
    font-weight: 600;
}

.vgt__axis-minor-cell {
    color: var(--vgt-muted);
    justify-content: center;
}

.vgt__axis-major-cell:first-child,
.vgt__axis-minor-cell:first-child {
    border-left: none;
}

.vgt__axis-minor-cell--weekend {
    background: var(--vgt-weekend);
}

.vgt__axis-minor-cell--today {
    color: var(--vgt-now);
    font-weight: 600;
}

.vgt__axis-label {
    position: sticky;
    left: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.vgt__body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
}

.vgt__body-inner {
    position: relative;
    min-height: 100%;
}

.vgt__grid {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
}

.vgt__grid-line {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid var(--vgt-border);
}

.vgt__grid-line--weekend {
    background: var(--vgt-weekend);
}

.vgt__now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px solid var(--vgt-now);
    z-index: 3;
}

.vgt__row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    box-sizing: border-box;
    border-bottom: 1px solid var(--vgt-border);
}

.vgt__row--drop-target {
    background: rgba(59, 130, 246, 0.06);
}

.vgt__row-label {
    position: relative;
    z-index: 2;
    flex: none;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    overflow: hidden;
    border-right: 1px solid var(--vgt-border-strong);
    padding: 0 8px;
    background: var(--vgt-label-bg);
}

.vgt__group-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vgt__row-content {
    position: relative;
    flex: 1;
    min-width: 0;
}

.vgt__background {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--vgt-weekend);
}

.vgt__item {
    position: absolute;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    overflow: hidden;
    border: 1px solid var(--vgt-item-border);
    border-radius: 4px;
    background: var(--vgt-item-bg);
    color: var(--vgt-item-text);
    padding: 0 2px;
}

.vgt__item--editable {
    cursor: grab;
}

.vgt__item--dragging {
    z-index: 4;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
    cursor: grabbing;
}

.vgt__item--clipped-start {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left-style: dashed;
}

.vgt__item--clipped-end {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right-style: dashed;
}

.vgt__item-content {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 0 4px;
}

.vgt__handle {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 1;
    width: 8px;
    cursor: ew-resize;
    opacity: 0;
}

.vgt__handle--start {
    left: 0;
}

.vgt__handle--end {
    right: 0;
}

.vgt__item:hover .vgt__handle {
    opacity: 1;
    background: rgba(15, 23, 42, 0.2);
}

.vgt__empty {
    padding: 16px;
    color: var(--vgt-muted);
    text-align: center;
}
</style>
