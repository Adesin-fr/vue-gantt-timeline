export type DateLike = Date | string | number

/**
 * Plage horaire récurrente retirée de l'axe (heures de nuit, week-end, pause...).
 * Les bornes sont au format `HH:mm` (`24:00` accepté pour la fin). Si `start` est après `end`,
 * la plage passe minuit : `{ start: '18:00', end: '08:00' }` masque la nuit.
 */
export interface HiddenTimeRange {
    start: string
    end: string
    /** Jours de début concernés (0 = dimanche … 6 = samedi) ; absent = tous les jours. */
    days?: number[]
}

/** Une ligne du planning (un utilisateur, une machine, ...). */
export interface GanttGroup {
    id: string | number
    /** Libellé affiché dans la colonne de gauche (défaut : l'id). */
    label?: string
    className?: string
    style?: string | Record<string, string>
    /** Hauteur minimale forcée pour cette ligne, en pixels. */
    minHeight?: number
    [key: string]: unknown
}

/** Un bloc posé sur la ligne d'un groupe. */
export interface GanttItem {
    id: string | number
    /** Id du groupe (ligne) sur lequel le bloc est posé. */
    group: string | number
    start: DateLike
    /** Absent = bloc ponctuel (rendu à la largeur minimale). */
    end?: DateLike
    /** Texte affiché quand aucun slot / itemRenderer n'est fourni. */
    content?: string
    /** Attribut title natif (tooltip navigateur). */
    title?: string
    className?: string
    style?: string | Record<string, string>
    /** `background` : bloc non déplaçable rendu derrière les autres, sans empilement. */
    type?: 'range' | 'background'
    /** Surcharge l'option `editable` du composant pour ce bloc. */
    editable?: boolean | Partial<GanttEditable>
    [key: string]: unknown
}

export interface GanttEditable {
    /** Autorise le déplacement / redimensionnement dans le temps. */
    updateTime: boolean
    /** Autorise le déplacement d'un groupe à l'autre. */
    updateGroup: boolean
}

export type GanttEditableOption = boolean | Partial<GanttEditable>

/** Résultat du calcul de position d'un bloc pour le rendu. */
export interface GanttPlacedItem {
    item: GanttItem
    /** Ligne virtuelle d'empilement à l'intérieur du groupe (0 = la plus haute). */
    lane: number
    /** Position et largeur en pixels, déjà rognées sur la fenêtre affichée. */
    left: number
    width: number
    startMs: number
    endMs: number
    /** Le bloc commence avant / finit après la fenêtre affichée. */
    clippedStart: boolean
    clippedEnd: boolean
    dragging: boolean
}

export interface GanttRow {
    group: GanttGroup
    key: string
    top: number
    height: number
    lanes: number
    items: GanttPlacedItem[]
    background: GanttPlacedItem[]
}

export type GanttDragKind = 'move' | 'resize'

/** Payload des évènements `item-drag`, `item-move` et `item-resize`. */
export interface GanttItemMoveEvent {
    item: GanttItem
    kind: GanttDragKind
    start: Date
    end: Date
    group: string | number
    previousStart: Date
    previousEnd: Date
    previousGroup: string | number
    /** Le groupe a changé pendant le déplacement. */
    groupChanged: boolean
}

export interface GanttItemPointerEvent {
    item: GanttItem
    group: GanttGroup
    event: MouseEvent
}

export interface GanttBackgroundEvent {
    group: GanttGroup
    time: Date
    event: MouseEvent
}

/** Payload de `range-change` : nouvelle fenêtre après un déplacement ou un zoom. */
export interface GanttRangeChangeEvent {
    start: Date
    end: Date
    reason: GanttRangeChangeReason
}

export type GanttRangeChangeReason = 'pan' | 'zoom'

export interface GanttGroupEvent {
    group: GanttGroup
    event: MouseEvent
}

/** Fonction de rendu alternative au slot `item` : renvoie du HTML. */
export type GanttItemRenderer = (item: GanttItem, group: GanttGroup) => string

/** Arrondi appliqué aux dates pendant un déplacement. */
export type GanttSnap = number | ((date: Date, kind: GanttDragKind) => DateLike) | null
