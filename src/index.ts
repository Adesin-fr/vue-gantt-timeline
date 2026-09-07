import type { App } from 'vue'
import GanttTimeline from './GanttTimeline.vue'

export { GanttTimeline }
export * from './types'
export { buildTimeAxis, toMs, floorDate, addDate } from './utils/time'
export { stackItems } from './utils/stack'

export default {
    install(app: App) {
        app.component('GanttTimeline', GanttTimeline)
    },
}
