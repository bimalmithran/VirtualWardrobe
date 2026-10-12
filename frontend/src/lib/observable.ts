/** Minimal listener set shared by the app's observable services. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  emit(value: T) {
    this.listeners.forEach((l) => l(value));
  }
}
