import { Injectable } from '@angular/core';
import * as rxjs from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class KeyboardStateService {
  readonly #ctrlKey$ = new rxjs.BehaviorSubject(false);
  readonly #shiftKey$ = new rxjs.BehaviorSubject(false);
  readonly #altKey$ = new rxjs.BehaviorSubject(false);
  readonly #metaKey$ = new rxjs.BehaviorSubject(false);

  readonly ctrlKey$ = this.#ctrlKey$.asObservable();
  readonly shiftKey$ = this.#shiftKey$.asObservable();
  readonly altKey$ = this.#altKey$.asObservable();
  readonly metaKey$ = this.#metaKey$.asObservable();

  get ctrlKey() { return this.#ctrlKey$.value }
  get shiftKey() { return this.#shiftKey$.value }
  get altKey() { return this.#altKey$.value }
  get metaKey() { return this.#metaKey$.value }

  constructor() {
    const listener = (ev: KeyboardEvent | MouseEvent) => {
      if (this.#ctrlKey$.value != ev.ctrlKey) this.#ctrlKey$.next(ev.ctrlKey);
      if (this.#shiftKey$.value != ev.shiftKey) this.#shiftKey$.next(ev.shiftKey);
      if (this.#altKey$.value != ev.altKey) this.#altKey$.next(ev.altKey);
      if (this.#metaKey$.value != ev.metaKey) this.#metaKey$.next(ev.metaKey);
    };
    window.addEventListener('keydown', listener, { capture: true });
    window.addEventListener('keyup', listener, { capture: true });
    window.addEventListener('mousemove', listener, { capture: true });
  }
}
