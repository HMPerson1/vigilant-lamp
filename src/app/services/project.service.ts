import { Injectable, Signal, WritableSignal, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import * as msgpack from '@msgpack/msgpack';
import { getOrElseW } from 'fp-ts/Either';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';
import { pipe } from 'fp-ts/function';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { AudioSamples } from '../common';
import { Meter, Project } from '../ui-common';
import { signalDefined, signalFiltered } from '../utils/ho-signals';
import { PairsSet } from '../utils/pairs-set';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  #currentProject$ = new Subject<ProjectHolder>();
  get currentProject$(): Observable<ProjectHolder> { return this.#currentProject$ }
  readonly currentProjectRaw = toSignal(this.#currentProject$);
  readonly currentProject = signalDefined(this.currentProjectRaw);

  newProject(audioFile: Uint8Array, audio: AudioSamples) {
    this.#currentProject$.next(new ProjectHolder({ audioFile, audio, meter: undefined, parts: [] }))
  }

  async fromBlob(blob: Blob) {
    const projHolder = new ProjectHolder(pipe(
      Project.decode(await msgpack.decodeAsync(blob.stream()) as any),
      getOrElseW((e) => { console.log("fromBlob:", e); throw new Error(`${e[0].context.at(-1)?.key}:${e[0].value}`); })
    ));
    this.#currentProject$.next(projHolder);
    return projHolder;
  }
}

type ModifyOpts = {
  fusionTag?: string;
  preserveSelection?: boolean;
};

export interface FilteredProjectHolder<T> {
  project: Signal<Project & T>;
  modify(op: (a: Project & T) => Project, opts?: ModifyOpts): void;
}

export type NoteSelection = PairsSet<number, number>;

export class ProjectHolder implements FilteredProjectHolder<unknown> {
  #history: NonEmptyArray<[Project, boolean]>;
  #current: number = 0;
  get #projectInternal(): Project { return this.#history[this.#current][0] }
  readonly #project$: BehaviorSubject<Project>;
  readonly project$: Observable<Project>;
  readonly project: Signal<Project>;

  readonly #lastSaved = signal<Project | undefined>(undefined);
  readonly isUnsaved = computed(() => !Object.is(this.project(), this.#lastSaved()));

  #prevModFusionTag?: string;
  #prevModTime?: number;

  readonly currentSelection: NoteSelection = PairsSet.empty();

  readonly withMeter: Signal<FilteredProjectHolder<WithMeter> | undefined>;

  constructor(prj: Project) {
    this.#history = [[prj, false]];
    this.#project$ = new BehaviorSubject(this.#projectInternal);
    this.project$ = this.#project$.asObservable();
    const projectW = signal(this.#projectInternal);
    this.#project$.subscribe(v => projectW.set(v));
    this.project = projectW.asReadonly();
    this.withMeter = this.filterProject<WithMeter>((a): a is Project & WithMeter => a.meter !== undefined);
  }

  intoBlob(): Blob {
    return new Blob([msgpack.encode(Project.encode(this.#projectInternal))]);
  }

  /** if the previous modification had the same fusion tag, a new undo state may not be created */
  modify(op: (a: Project) => Project, opts?: ModifyOpts) {
    const next = op(this.#projectInternal);
    const modTime = performance.now();
    const preserveSelection = !!opts?.preserveSelection;
    if (
      this.#prevModFusionTag !== undefined
      && this.#prevModFusionTag === opts?.fusionTag // implies `fusionTag !== undefined`
      && this.#prevModTime !== undefined
      && modTime - this.#prevModTime <= MAX_FUSION_TIMEOUT
      && this.#current === this.#history.length - 1
    ) {
      const lastPS = this.#history[this.#current][1]
      this.#history[this.#current] = [next, preserveSelection && lastPS];
    } else {
      this.#current++;
      this.#history.splice(this.#current, Infinity, [next, preserveSelection]);
    }
    // always reset timestamp to allow "chaining" changes
    this.#prevModFusionTag = opts?.fusionTag;
    this.#prevModTime = modTime;
    this.#project$.next(this.#projectInternal);
    if (!preserveSelection) {
      this.currentSelection?.clear();
    }
  }

  canUndo() { return this.#current > 0 }

  undo() {
    if (!this.canUndo()) return;
    this.#prevModFusionTag = undefined;
    this.#current--;
    this.#project$.next(this.#projectInternal);
    if (!this.#history[this.#current + 1][1]) {
      this.currentSelection?.clear();
    }
  }

  canRedo() { return this.#current < this.#history.length - 1 }

  redo() {
    if (!this.canRedo()) return;
    this.#prevModFusionTag = undefined;
    this.#current++;
    this.#project$.next(this.#projectInternal);
    if (!this.#history[this.#current][1]) {
      this.currentSelection?.clear();
    }
  }

  markSaved() {
    this.#lastSaved.set(this.#projectInternal);
  }

  filterProject<T>(filter: (a: Project) => a is Project & T): Signal<FilteredProjectHolder<T> | undefined> {
    return signalFiltered(this.project, filter, (project) => ({
      project,
      modify: (op, opts) => {
        try {
          this.modify((p) => {
            if (!filter(p)) {
              console.error('attempt to modify filtered project holder at invalid state', filter, p);
              console.trace();
              throw filterProjectNoopThrowable;
            }
            return op(p);
          }, opts);
        } catch (e) {
          if (e !== filterProjectNoopThrowable) throw e;
        }
      },
    }),);
  }
}

/** if two modifications are more than this many milliseconds apart, they will not be merged */
const MAX_FUSION_TIMEOUT: DOMHighResTimeStamp = 1000;
const filterProjectNoopThrowable: unique symbol = Symbol();

type WithMeter = { meter: Meter };
