import { Signal, computed, } from '@angular/core';
import { identity } from 'fp-ts/function';

export const signalDefined = <T>(inputSig: Signal<T | undefined>): Signal<Signal<T> | undefined> =>
  signalFiltered(inputSig, isNonnull, identity);

/** it is assumed that `undefined` is not assignable to `V` */
export const signalFiltered = <T, U extends T, V>(inputSig: Signal<T>, filter: (a: T) => a is U, innerBuilder: (a: Signal<U>) => V): Signal<V | undefined> => {
  let inner: V | undefined;
  return computed(() => {
    const v = inputSig();
    if (!filter(v)) return undefined;
    if (inner === undefined) inner = innerBuilder(signalLastFiltered(inputSig, filter, v));
    return inner;
  });
};

const signalLastFiltered = <T, U extends T>(inputSig: Signal<T>, filter: (a: T) => a is U, initialValue: U): Signal<U> => {
  let lastVal = initialValue;
  return computed(() => {
    const v = inputSig();
    if (filter(v)) lastVal = v;
    return lastVal;
  });
};

export function isNonnull<T>(x: T): x is NonNullable<T> { return x != null }
