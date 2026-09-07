import type { GanttPlacedItem } from '../types'

/**
 * Empile les blocs d'un groupe sur des lignes virtuelles.
 *
 * Les blocs sont traités du plus à gauche au plus à droite ; chacun est posé sur la
 * première ligne où il ne chevauche rien (ligne 0 en priorité), et une nouvelle ligne
 * n'est créée que si aucune des précédentes ne peut l'accueillir : la hauteur du groupe
 * n'augmente donc jamais sans nécessité.
 *
 * La détection de chevauchement se fait en pixels (et non en dates) pour que deux blocs
 * visuellement collés — largeur minimale appliquée — soient aussi séparés verticalement.
 *
 * Mute `lane` sur chaque élément et renvoie le nombre de lignes utilisées.
 */
export function stackItems(placed: GanttPlacedItem[], marginPx = 2): number {
    if (placed.length === 0) {
        return 0
    }

    const ordered = [...placed].sort((a, b) => a.left - b.left || a.startMs - b.startMs)
    const laneEnds: number[] = []

    for (const entry of ordered) {
        const start = entry.left
        const end = entry.left + entry.width

        let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start - marginPx)
        if (lane === -1) {
            lane = laneEnds.length
            laneEnds.push(end)
        } else {
            laneEnds[lane] = Math.max(laneEnds[lane], end)
        }

        entry.lane = lane
    }

    return laneEnds.length
}
