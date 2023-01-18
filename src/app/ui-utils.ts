import { Observable } from "rxjs";

// https://stackoverflow.com/a/65789933
export function resizeObservable(elem: Element, options?: ResizeObserverOptions): Observable<ResizeObserverEntry> {
  return new Observable(subscriber => {
    var ro = new ResizeObserver(entries => subscriber.next(entries[0]));
    ro.observe(elem, options);
    return () => ro.unobserve(elem)
  });
}
