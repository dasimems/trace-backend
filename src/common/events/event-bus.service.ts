import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface UserEvent<TPayload = unknown> {
  type: string;
  payload: TPayload;
  emittedAt: Date;
}

export type UserEventListener = (event: UserEvent) => void;

// In-process pub/sub keyed by userId. Single-instance for now — to scale
// horizontally, swap this for Redis pub/sub (publish on REDIS_CACHE, subscribe
// on a separate connection) and keep this surface identical.
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // Each connected SSE client adds one listener per channel. A user with
    // multiple tabs open quickly exceeds Node's default ceiling of 10.
    this.emitter.setMaxListeners(1024);
  }

  // Returns an unsubscribe function so callers don't have to track the
  // listener identity themselves.
  subscribe(userId: string, listener: UserEventListener): () => void {
    this.emitter.on(userId, listener);
    return () => this.emitter.off(userId, listener);
  }

  publish<T>(userId: string, event: Omit<UserEvent<T>, 'emittedAt'>): void {
    const full: UserEvent<T> = { ...event, emittedAt: new Date() };
    this.logger.debug(`publish ${event.type} to user=${userId}`);
    this.emitter.emit(userId, full);
  }

  // Useful for tests and dev tooling.
  listenerCount(userId: string): number {
    return this.emitter.listenerCount(userId);
  }
}
