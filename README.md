# vue-gantt-timeline

Composant Vue 3 de planning / gantt : une colonne de groupes à gauche, une fenêtre de dates
figée à droite, des blocs déplaçables et empilés automatiquement.

- rendu strictement limité à la fenêtre `[start, end]` : aucun bloc « fantôme » hors plage ;
- empilement au plus juste : un bloc est posé sur la première ligne virtuelle libre, une nouvelle
  ligne n'est créée que si aucune ne peut l'accueillir ;
- déplacement dans le temps et d'un groupe à l'autre, redimensionnement par les bords, avec
  évènements émis à chaque fois ;
- rendu des blocs par slot ou par fonction ;
- virtualisation verticale : seules les lignes visibles sont montées (centaines de groupes OK) ;
- aucune dépendance runtime en dehors de Vue.

La fenêtre affichée est pilotée par les props `start` / `end`. Deux gestes optionnels la font
varier, désactivés par défaut :

- `pannable` — clic-glisser dans le vide pour faire défiler la plage de dates (le mouvement
  vertical fait défiler les groupes en même temps) ;
- `zoomable` — pincement (gestes WebKit ou deux doigts) et molette + <kbd>ctrl</kbd>
  (<kbd>cmd</kbd> sur macOS), avec zoom centré sur le curseur.

Dans les deux cas le composant émet `range-change` et `update:start` / `update:end` : la
fenêtre se pilote donc au choix par `v-model:start` / `v-model:end` ou à la main. Une molette
sans modificateur conserve son rôle de défilement vertical.

## Installation

```bash
npm install @adesin-fr/vue-gantt-timeline
```

```js
import { GanttTimeline } from '@adesin-fr/vue-gantt-timeline'
import '@adesin-fr/vue-gantt-timeline/style.css'
```

## Utilisation

```vue
<GanttTimeline
    :groups="[{ id: 1, label: 'Atelier' }]"
    :items="[{ id: 'a', group: 1, start: '2026-09-07 08:00', end: '2026-09-07 12:00', content: 'OT 1234' }]"
    :start="windowStart"
    :end="windowEnd"
    :editable="{ updateTime: true, updateGroup: true }"
    @item-move="onMove"
    @item-resize="onMove"
>
    <template #item="{ item }">
        <strong>{{ item.content }}</strong>
    </template>
</GanttTimeline>
```

Le composant ne modifie jamais `items` : à réception de `item-move` / `item-resize`, c'est au
parent d'appliquer (ou de refuser) le nouveau positionnement. Tant qu'il ne le fait pas, le bloc
revient à sa position d'origine.

### Props

| Prop | Défaut | Rôle |
| --- | --- | --- |
| `groups` | — | lignes du planning (`{ id, label?, className?, style?, minHeight? }`) |
| `items` | — | blocs (`{ id, group, start, end?, content?, title?, className?, style?, type?, editable? }`) |
| `start`, `end` | — | fenêtre affichée (`Date`, timestamp, ISO ou `YYYY-MM-DD HH:mm:ss`) |
| `editable` | `false` | `boolean` ou `{ updateTime, updateGroup }`, surchargeable par bloc |
| `snap` | `900000` | arrondi pendant un déplacement : ms ou `(date, kind) => date` |
| `minDuration` | `300000` | durée minimale d'un bloc au redimensionnement |
| `stack` | `true` | empilement des blocs qui se chevauchent |
| `order` | — | tri des blocs d'un groupe avant empilement |
| `itemRenderer` | — | `(item, group) => string` (HTML) si le slot `item` n'est pas utilisé |
| `groupWidth` | `180` | largeur de la colonne des groupes |
| `laneHeight` / `laneGap` / `rowPadding` / `minRowHeight` | `26` / `2` / `4` / `40` | métriques verticales |
| `minItemWidth` / `itemMargin` | `6` / `2` | largeur minimale d'un bloc, écart de collision |
| `locale` / `weekStart` | navigateur / `1` | axe temporel |
| `showCurrentTime` | `true` | trait de l'heure courante |
| `overscan` | `3` | lignes rendues hors zone visible |
| `pannable` | `false` | défilement de la plage au clic-glisser dans le vide |
| `zoomable` | `false` | zoom au pincement et à la molette + ctrl/cmd |
| `zoomMin` / `zoomMax` | `600000` / 5 ans | amplitude minimale et maximale de la fenêtre au zoom |
| `minDate` / `maxDate` | — | bornes au-delà desquelles la fenêtre ne peut pas aller |

### Évènements

| Évènement | Payload |
| --- | --- |
| `item-drag` | position provisoire, émise pendant le déplacement |
| `item-move` | déplacement validé (temps et/ou groupe) |
| `item-resize` | redimensionnement validé |
| `item-click`, `item-dblclick`, `item-contextmenu` | `{ item, group, event }` |
| `background-click`, `background-dblclick` | `{ group, time, event }` — création de bloc |
| `group-click`, `group-dblclick` | `{ group, event }` |
| `range-change` | `{ start, end, reason: 'pan' \| 'zoom' }` |
| `update:start`, `update:end` | nouvelle borne (`v-model:start` / `v-model:end`) |

`item-drag` / `item-move` / `item-resize` reçoivent
`{ item, kind, start, end, group, previousStart, previousEnd, previousGroup, groupChanged }`.

Le composant expose aussi `setWindow(start, end)`, `scrollToGroup(id)`, `timeToX`, `xToTime`.

### Slots

- `item` — `{ item, group, placed }`, contenu d'un bloc ;
- `group` — `{ group, row }`, libellé d'une ligne ;
- `corner` — coin haut-gauche ;
- `empty` — aucun groupe.

### Personnalisation

Les couleurs passent par des variables CSS sur `.vgt` (`--vgt-item-bg`, `--vgt-border`,
`--vgt-now`, …) ; `className` et `style` sur un bloc ou un groupe restent prioritaires.

## Développement

```bash
npm run dev          # playground (demo/App.vue)
npm run build        # vérification des types + build de la lib dans dist/
npm run build:watch  # rebuild à chaud, pratique avec un `npm link`
```

### Lien local vers une application

```bash
cd /chemin/vers/ganttTimeline && npm link
cd /chemin/vers/application && npm link @adesin-fr/vue-gantt-timeline
```

Côté application Vite, dédupliquer Vue (le paquet lié embarque le sien) :

```js
resolve: { dedupe: ['vue'] },
server: { fs: { allow: ['..'] } },
optimizeDeps: { exclude: ['@adesin-fr/vue-gantt-timeline'] },
```
