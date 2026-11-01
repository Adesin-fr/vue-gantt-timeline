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
 * Quand le bloc suivant commence avant la fin du précédent, la flèche contourne : elle descend entre les
 * deux lignes avant de revenir vers la gauche. Une dépendance dont l'un des blocs n'est
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

        if (x2 >= x1) {
            // Coude à `stub` du départ, ou au milieu de l'écart quand il est trop court pour ça.
            const midX = x2 - x1 >= stub * 2 ? x1 + stub : (x1 + x2) / 2
            d = y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`
        } else {
            // Le contournement passe sur la bordure entre les deux lignes, ou sous le bloc
            // de départ quand les deux blocs sont sur la même ligne.
            const midY = y2 >= y1
                ? (from.rowBottom <= to.rowTop ? from.rowBottom : y1 + metrics.laneHeight / 2 + metrics.laneGap / 2)
                : (to.rowBottom <= from.rowTop ? from.rowTop : y1 - metrics.laneHeight / 2 - metrics.laneGap / 2)
            d = `M ${x1} ${y1} H ${x1 + stub} V ${midY} H ${x2 - stub} V ${y2} H ${x2}`
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
