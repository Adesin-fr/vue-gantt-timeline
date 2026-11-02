import type { GanttDependency, GanttItem, GanttRow } from '../types'

/** Tracé d'une flèche de dépendance, en pixels dans la zone des blocs. */
export interface GanttDependencyPath {
    key: string
    dependency: GanttDependency
    /** Attribut `d` d'un `<path>` SVG. */
    d: string
}

export interface DependencyMetrics {
    rowPadding: number
    laneHeight: number
    laneGap: number
    /** Longueur du segment horizontal qui sort d'un bloc et qui entre dans le suivant. */
    stub?: number
}

interface Anchor {
    left: number
    right: number
    y: number
    rowTop: number
    rowBottom: number
}

/**
 * Calcule les flèches de dépendance : chacune part du bord droit du bloc `from` et arrive
 * sur le bord gauche du bloc `to`, au milieu de leur ligne d'empilement.
 *
 * Les flèches sont des courbes de Bézier : une courbe en S d'une ligne à l'autre, arrondie
 * même quand la fin et le début coïncident. Quand le bloc suivant commence avant la fin du
 * précédent, la flèche contourne : elle s'arrondit entre les deux lignes avant de revenir
 * vers la gauche. Une dépendance dont l'un des blocs n'est
 * pas rendu (hors fenêtre, masqué ou absent) n'est pas tracée.
 */
export function buildDependencyPaths(
    rows: GanttRow[],
    dependencies: GanttDependency[],
    metrics: DependencyMetrics,
): GanttDependencyPath[] {
    if (dependencies.length === 0) {
        return []
    }

    const anchors = new Map<string, Anchor>()
    for (const row of rows) {
        for (const placed of row.items) {
            anchors.set(String(placed.item.id), {
                left: placed.left,
                right: placed.left + placed.width,
                y: row.top + metrics.rowPadding + placed.lane * (metrics.laneHeight + metrics.laneGap) + metrics.laneHeight / 2,
                rowTop: row.top,
                rowBottom: row.top + row.height,
            })
        }
    }

    const stub = metrics.stub ?? 8
    const paths: GanttDependencyPath[] = []

    for (const dependency of dependencies) {
        const from = anchors.get(String(dependency.from))
        const to = anchors.get(String(dependency.to))
        if (!from || !to) {
            continue
        }

        const x1 = from.right
        const x2 = to.left
        const y1 = from.y
        const y2 = to.y
        let d: string

        // Les points de contrôle sont horizontaux aux deux bouts : la flèche sort du bloc vers
        // la droite et entre dans le suivant par la gauche, la pointe reste donc bien orientée.
        // `bend` fixe la largeur minimale de l'arrondi, pour qu'il reste visible même quand
        // la fin et le début coïncident.
        const bend = stub * 3

        if (x2 >= x1 && y1 !== y2) {
            // Courbe en S d'une ligne à l'autre.
            const k = Math.max(bend, (x2 - x1) / 2)
            d = `M ${x1} ${y1} C ${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`
        } else if (x2 - x1 >= stub * 2) {
            // Même ligne d'empilement, assez d'écart : le trait droit se voit.
            d = `M ${x1} ${y1} H ${x2}`
        } else {
            // Contournement : le bloc suivant commence avant la fin du précédent, ou juste
            // après sur la même ligne. La flèche s'arrondit vers la bordure entre les deux
            // lignes (ou sous le bloc de départ sur une même ligne), revient vers la gauche
            // puis s'arrondit de nouveau pour entrer dans le bloc suivant.
            // Sur une même ligne, l'arrondi descend un peu sous le bloc pour ne pas s'y cacher.
            const clearance = metrics.laneHeight / 2 + Math.max(metrics.laneGap / 2, stub / 2)
            const midY = y2 >= y1
                ? (from.rowBottom <= to.rowTop ? from.rowBottom : y1 + clearance)
                : (to.rowBottom <= from.rowTop ? from.rowTop : y1 - clearance)
            d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x1 + bend} ${midY}, ${x1} ${midY}`
                + ` H ${x2} C ${x2 - bend} ${midY}, ${x2 - bend} ${y2}, ${x2} ${y2}`
        }

        paths.push({
            key: String(dependency.id ?? `${dependency.from}->${dependency.to}`),
            dependency,
            d,
        })
    }

    return paths
}

/** Ensemble mis en évidence : les clés de blocs de la chaîne et les flèches qui la relient. */
export interface GanttDependencyChain {
    keys: Set<string>
    dependencies: Set<GanttDependency>
}

/**
 * Chaîne complète d'un bloc : tous ses parents (ce qu'il attend, de proche en proche) et
 * tous ses enfants (ce qui l'attend). Les branches sœurs ne sont pas incluses : le parent
 * d'un bloc en fait partie, mais pas les autres blocs qui attendent ce parent.
 *
 * `keyOf` regroupe des blocs en un seul maillon (une même tâche affichée sur plusieurs
 * lignes, par exemple) ; par défaut chaque bloc est son propre maillon.
 */
export function dependencyChain(
    items: GanttItem[],
    dependencies: GanttDependency[],
    item: GanttItem,
    keyOf: (item: GanttItem) => string | number = (candidate) => candidate.id,
): GanttDependencyChain {
    const keyById = new Map(items.map((candidate) => [String(candidate.id), String(keyOf(candidate))]))
    const edges = dependencies
        .map((dependency) => ({
            dependency,
            from: keyById.get(String(dependency.from)),
            to: keyById.get(String(dependency.to)),
        }))
        .filter((edge): edge is { dependency: GanttDependency; from: string; to: string } => !!edge.from && !!edge.to)

    const start = String(keyOf(item))
    const walk = (forward: boolean) => {
        const reached = new Set([start])
        const queue = [start]
        while (queue.length > 0) {
            const key = queue.shift()!
            for (const edge of edges) {
                const [origin, target] = forward ? [edge.from, edge.to] : [edge.to, edge.from]
                if (origin === key && !reached.has(target)) {
                    reached.add(target)
                    queue.push(target)
                }
            }
        }
        return reached
    }

    const descendants = walk(true)
    const ancestors = walk(false)
    const keys = new Set([...ancestors, ...descendants])

    return {
        keys,
        dependencies: new Set(
            edges
                .filter((edge) => (ancestors.has(edge.from) && ancestors.has(edge.to)) || (descendants.has(edge.from) && descendants.has(edge.to)))
                .map((edge) => edge.dependency),
        ),
    }
}
