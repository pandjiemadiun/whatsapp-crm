import { EventEmitter } from 'events';
const emitter = new EventEmitter();
/**
 * publish() adalah sinkron (EventEmitter). Consumer (realtime.service) melakukan
 * emit WS secara sync/async — sekalipun emit gagal, tidak boleh mengganngi
 * engine/delivery yang sedang menyelesaikan request.
 */
export const eventBus = {
    publish(env) {
        emitter.emit(env.event, env);
    },
    /** @returns unsubscribe function */
    subscribe(event, listener) {
        const wrapper = listener;
        emitter.on(event, wrapper);
        return () => emitter.off(event, wrapper);
    },
};
//# sourceMappingURL=event-bus.service.js.map