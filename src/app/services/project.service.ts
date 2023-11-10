import { Injectable, Signal, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import * as msgpack from '@msgpack/msgpack';
import { getOrElseW } from 'fp-ts/Either';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';
import { pipe } from 'fp-ts/function';
import { Observable, Subject } from 'rxjs';
import { AudioSamples } from '../common';
import { Project } from '../ui-common';
import { signalDefined, signalFiltered } from '../utils/ho-signals';

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

export interface FilteredProjectHolder<T> {
  project: Signal<Project & T>;
  modify(op: (a: Project & T) => Project, fusionTag?: string): void;
}

export class ProjectHolder implements FilteredProjectHolder<unknown> {
  #history: NonEmptyArray<Project>;
  #current: number = 0;
  get #projectInternal(): Project { return this.#history[this.#current] }
  #project = signal(this.#projectInternal);
  project = this.#project.asReadonly();

  #lastSaved = signal<Project | undefined>(undefined);
  isUnsaved = computed(() => !Object.is(this.#project(), this.#lastSaved()));

  #prevModFusionTag?: string;
  #prevModTime?: number;

  constructor(prj: Project) {
    this.#history = [prj];
  }

  intoBlob(): Blob {
    return new Blob([msgpack.encode(Project.encode(this.#projectInternal))]);
  }

  /** if the previous modification had the same fusion tag, a new undo state may not be created */
  modify(op: (a: Project) => Project, fusionTag?: string) {
    const next = op(this.#projectInternal);
    const modTime = performance.now();
    if (
      this.#prevModFusionTag !== undefined
      && this.#prevModFusionTag === fusionTag // implies `fusionTag !== undefined`
      && this.#prevModTime !== undefined
      && modTime - this.#prevModTime <= MAX_FUSION_TIMEOUT
    ) {
      this.#history[this.#current] = next;
    } else {
      this.#current++;
      this.#history.splice(this.#current);
      this.#history.push(next);
    }
    // always reset timestamp to allow "chaining" changes
    this.#prevModFusionTag = fusionTag;
    this.#prevModTime = modTime;
    this.#project.set(this.#projectInternal);
  }

  canUndo() { return this.#current >= 1 }

  undo() {
    if (!this.canUndo()) return;
    this.#current--;
    this.#project.set(this.#projectInternal);
  }

  canRedo() { return this.#current + 1 <= this.#history.length - 1 }

  redo() {
    if (!this.canRedo()) return;
    this.#current++;
    this.#project.set(this.#projectInternal);
  }

  markSaved() {
    this.#lastSaved.set(this.#projectInternal);
  }

  filterProject<T>(filter: (a: Project) => a is Project & T): Signal<FilteredProjectHolder<T> | undefined> {
    return signalFiltered(this.#project, filter, (project) => ({
      project,
      modify: (op, fusionTag) => {
        try {
          this.modify((p) => {
            if (!filter(p)) {
              console.error('attempt to modify filtered project holder at invalid state', filter, p);
              console.trace();
              throw filterProjectNoopThrowable;
            }
            return op(p);
          }, fusionTag);
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
