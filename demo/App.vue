<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GanttTimeline from '../src/GanttTimeline.vue'
import type { GanttGroup, GanttItem, GanttItemMoveEvent } from '../src/types'

const DAY = 86_400_000
const HOUR = 3_600_000

const groupCount = ref(100)
const itemsPerGroup = ref(6)
const rangeDays = ref(14)
const editable = ref(true)
const useSlot = ref(true)
const pannable = ref(true)
const zoomable = ref(true)

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

const windowStart = ref(startOfDay(new Date()))
const windowEnd = ref(new Date(windowStart.value.getTime() + rangeDays.value * DAY))

// Le champ « jours affichés » repositionne la fenêtre ; le pan et le zoom la modifient ensuite
// directement via v-model:start / v-model:end.
watch(rangeDays, (days) => (windowEnd.value = new Date(windowStart.value.getTime() + days * DAY)))

const visibleDays = computed(
    () => (windowEnd.value.getTime() - windowStart.value.getTime()) / DAY,
)

const COLORS = ['#d7ecff', '#ffe4c7', '#dcf5dd', '#f6d9f0', '#e5e1ff']

function generate() {
    const nextGroups: GanttGroup[] = []
    const nextItems: GanttItem[] = []
    const base = windowStart.value.getTime()

    for (let g = 0; g < groupCount.value; g++) {
        nextGroups.push({ id: g, label: `Ressource ${g + 1}` })

        for (let i = 0; i < itemsPerGroup.value; i++) {
            const start = base + Math.random() * rangeDays.value * DAY
            const duration = (1 + Math.floor(Math.random() * 12)) * HOUR
            nextItems.push({
                id: `${g}-${i}`,
                group: g,
                start: new Date(start),
                end: new Date(start + duration),
                content: `OT ${g + 1}.${i + 1}`,
                reference: `2026-${String(g + 1).padStart(3, '0')}`,
                style: { background: COLORS[(g + i) % COLORS.length] },
            })
        }
    }

    groups.value = nextGroups
    items.value = nextItems
}

const groups = ref<GanttGroup[]>([])
const items = ref<GanttItem[]>([])
const log = ref<string[]>([])

generate()

function pushLog(label: string, payload: GanttItemMoveEvent) {
    log.value.unshift(
        `${label} · ${payload.item.id} · ${payload.start.toLocaleString()} → ${payload.end.toLocaleString()} · groupe ${payload.previousGroup} → ${payload.group}`,
    )
    log.value = log.value.slice(0, 8)
}

function applyMove(payload: GanttItemMoveEvent, label: string) {
    const target = items.value.find((item) => item.id === payload.item.id)
    if (target) {
        target.start = payload.start
        target.end = payload.end
        target.group = payload.group
    }
    pushLog(label, payload)
}

function shift(direction: number) {
    const span = windowEnd.value.getTime() - windowStart.value.getTime()
    windowStart.value = new Date(windowStart.value.getTime() + direction * span)
    windowEnd.value = new Date(windowEnd.value.getTime() + direction * span)
}

function goToToday() {
    const span = windowEnd.value.getTime() - windowStart.value.getTime()
    windowStart.value = startOfDay(new Date())
    windowEnd.value = new Date(windowStart.value.getTime() + span)
}
</script>

<template>
    <div class="demo">
        <h1>vue-gantt-timeline</h1>

        <div class="toolbar">
            <button @click="shift(-1)">←</button>
            <button @click="goToToday">Aujourd'hui</button>
            <button @click="shift(1)">→</button>
            <label>Groupes <input v-model.number="groupCount" type="number" min="1" @change="generate" /></label>
            <label>Blocs/groupe <input v-model.number="itemsPerGroup" type="number" min="0" @change="generate" /></label>
            <label>Jours affichés <input v-model.number="rangeDays" type="number" min="1" /></label>
            <label><input v-model="editable" type="checkbox" /> éditable</label>
            <label><input v-model="useSlot" type="checkbox" /> rendu par slot</label>
            <label><input v-model="pannable" type="checkbox" /> pan</label>
            <label><input v-model="zoomable" type="checkbox" /> zoom</label>
            <span>{{ items.length }} blocs · {{ visibleDays.toFixed(1) }} j affichés</span>
        </div>

        <GanttTimeline
            class="demo__gantt"
            v-model:start="windowStart"
            v-model:end="windowEnd"
            :groups="groups"
            :items="items"
            :editable="editable"
            :pannable="pannable"
            :zoomable="zoomable"
            locale="fr-FR"
            @item-move="applyMove($event, 'move')"
            @item-resize="applyMove($event, 'resize')"
            @item-click="log.unshift('click · ' + $event.item.id)"
            @range-change="log.unshift($event.reason + ' · ' + $event.start.toLocaleString() + ' → ' + $event.end.toLocaleString())"
            @background-dblclick="log.unshift('création · groupe ' + $event.group.id + ' · ' + $event.time.toLocaleString())"
        >
            <template v-if="useSlot" #item="{ item }">
                <strong>{{ item.content }}</strong>
                <small> {{ item.reference }}</small>
            </template>
        </GanttTimeline>

        <ul class="log">
            <li v-for="(entry, index) in log" :key="index">{{ entry }}</li>
        </ul>
    </div>
</template>

<style>
body {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: #f1f5f9;
}

.demo {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100vh;
    box-sizing: border-box;
    padding: 16px;
}

.demo h1 {
    margin: 0;
    font-size: 18px;
}

.toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}

.toolbar input[type='number'] {
    width: 64px;
}

.demo__gantt {
    flex: 1;
    min-height: 0;
    background: #fff;
}

.log {
    flex: none;
    margin: 0;
    max-height: 140px;
    overflow: auto;
    padding-left: 18px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
}

.vgt__item small {
    opacity: 0.7;
}
</style>
