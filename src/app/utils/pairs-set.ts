export class PairsSet<T, U> {
  _inner: Map<T, Set<U>>;
  #singletonCache: readonly [T, U] | null | undefined;

  /// invariant: forall a, a in _inner => _inner[a].size > 0
  /// invariant: #singletonCache !== undefined => {{ cache is valid }}

  static empty(): PairsSet<never, never> {
    return new this(new Map<never, never>(), null);
  }

  static fromIterable<T, U>(iterable: Iterable<readonly [T, Iterable<U>]>): PairsSet<T, U> {
    return new this(new Map(function* () {
      for (const [t, ui] of iterable) {
        const us = new Set(ui);
        if (us.size > 0) yield [t, us];
      }
    }()), undefined);
  }

  static singleton<T, U>(value: readonly [T, U]) {
    const [t, u] = value;
    return new this(new Map([[t, new Set([u])]]), value);
  }

  private constructor(inner: Map<T, Set<U>>, singleton: readonly [T, U] | null | undefined) {
    this._inner = inner;
    this.#singletonCache = singleton;
  }

  get isEmpty(): boolean { return this._inner.size === 0 }

  get asSingleton(): readonly [T, U] | null {
    if (this.#singletonCache !== undefined) return this.#singletonCache;
    this.#singletonCache = null
    if (this._inner.size === 1) {
      const p = this._inner.entries().next();
      if (!p.done && p.value[1].size === 1) {
        const n = p.value[1].values().next();
        if (!n.done) {
          this.#singletonCache = [p.value[0], n.value];
        }
      }
    }
    return this.#singletonCache;
  }

  has(value: readonly [T, U]): boolean {
    const [t, u] = value;
    return this._inner.get(t)?.has(u) ?? false;
  }

  withFirst(t: T): ReadonlySet<U> | undefined { return this._inner.get(t) }

  add(value: readonly [T, U]) {
    this.#singletonCache = undefined;
    let [t, u] = value;
    const us = this._inner.get(t);
    if (us) {
      us.add(u);
    } else {
      this._inner.set(t, new Set([u]));
    }
  }

  delete(value: readonly [T, U]) {
    this.#singletonCache = undefined;
    let [t, u] = value;
    const us = this._inner.get(t);
    if (us) {
      const wasIn = us.delete(u);
      if (wasIn && us.size === 0) this._inner.delete(t);
    }
  }

  toggle(value: readonly [T, U]) {
    this.#singletonCache = undefined;
    let [t, u] = value;
    const us = this._inner.get(t);
    if (us) {
      const wasIn = us.delete(u);
      if (wasIn) {
        if (us.size === 0) this._inner.delete(t);
      } else {
        us.add(u);
      }
    } else {
      this._inner.set(t, new Set([u]));
    }
  }

  xorWith(other: PairsSet<T, U>) {
    this.#singletonCache = undefined;
    for (const [t, us] of other._inner) {
      const c = this._inner.get(t);
      if (c) {
        us.forEach(v => {
          const wasIn = c.delete(v);
          if (!wasIn) c.add(v);
        });
        if (c.size === 0) this._inner.delete(t);
      } else {
        this._inner.set(t, us);
      }
    }
  }

  unionWith(other: PairsSet<T, U>) {
    this.#singletonCache = undefined;
    for (const [t, us] of other._inner) {
      const c = this._inner.get(t);
      if (c) {
        us.forEach(v => c.add(v));
      } else {
        this._inner.set(t, us);
      }
    }
  }

  *[Symbol.iterator](): Iterator<[T, U]> {
    for (const [t, us] of this._inner) {
      for (const u of us) {
        yield [t, u];
      }
    }
  }
}
