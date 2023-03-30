import { clamp } from "lodash-es";
import { Observable } from "rxjs";

export type PitchLabelType = 'none' | 'midi' | 'sharp' | 'flat';

// https://stackoverflow.com/a/65789933
export function resizeObservable(elem: Element, options?: ResizeObserverOptions): Observable<ResizeObserverEntry> {
  return new Observable(subscriber => {
    var ro = new ResizeObserver(entries => subscriber.next(entries[0]));
    ro.observe(elem, options);
    return () => ro.unobserve(elem)
  });
}

export function doScrollZoom<PropMin extends string, PropMax extends string>(
  obj: { [x in PropMin | PropMax]: number }, propMin: PropMin, propMax: PropMax,
  clampMin: number, clampMax: number, rangeMin: number,
  zoomRate: number, scrollRate: number,
  wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  let rangeMax = clampMax - clampMin
  let valRange = obj[propMax] - obj[propMin]
  let valMin = obj[propMin]
  if (zoom) {
    let newValRange = valRange * (2 ** (wheelDelta * zoomRate));
    newValRange = clamp(newValRange, rangeMin, rangeMax)
    const deltaValRange = newValRange - valRange;
    valRange = newValRange
    valMin -= centerPosFrac * deltaValRange
  } else {
    valMin += valRange * (wheelDelta * scrollRate)
  }

  valMin = clamp(valMin, clampMin, clampMax - valRange)
  obj[propMin] = valMin
  obj[propMax] = valMin + valRange
}

export function doScrollZoomTime<PropMin extends string, PropMax extends string>(
  obj: { [x in PropMin | PropMax]: number }, propMin: PropMin, propMax: PropMax,
  clampMax: number | undefined, wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  doScrollZoom(
    obj, propMin, propMax,
    0, clampMax || 30, 1 / 1000, 1 / 400, 1 / 1600,
    wheelDelta, zoom, centerPosFrac,
  )
}

export const PITCH_MAX = 136;

export function doScrollZoomPitch<PropMin extends string, PropMax extends string>(
  obj: { [x in PropMin | PropMax]: number }, propMin: PropMin, propMax: PropMax,
  aspectRatio: number, wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  doScrollZoom(
    obj, propMin, propMax,
    0, PITCH_MAX, 6, 1 / 400, -1 / 1600 * aspectRatio,
    wheelDelta, zoom, centerPosFrac,
  )
}
