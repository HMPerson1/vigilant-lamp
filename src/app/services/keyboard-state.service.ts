import { Injectable, NgZone, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class KeyboardStateService {
  readonly #ctrlKey = signal(false);
  readonly #shiftKey = signal(false);
  readonly #altKey = signal(false);
  readonly #metaKey = signal(false);

  readonly ctrlKey = this.#ctrlKey.asReadonly();
  readonly shiftKey = this.#shiftKey.asReadonly();
  readonly altKey = this.#altKey.asReadonly();
  readonly metaKey = this.#metaKey.asReadonly();

  constructor(ngZone: NgZone) {
    const listener = (ev: KeyboardEvent | MouseEvent) => {
      this.#ctrlKey.set(ev.ctrlKey);
      this.#shiftKey.set(ev.shiftKey);
      this.#altKey.set(ev.altKey);
      this.#metaKey.set(ev.metaKey);
    };
    ngZone.runOutsideAngular(() => {
      window.addEventListener('keydown', listener, { capture: true });
      window.addEventListener('keyup', listener, { capture: true });
      window.addEventListener('mousemove', listener, { capture: true });
    })
  }
}
