import { Injectable, WritableSignal, signal } from '@angular/core';
import * as msgpack from '@msgpack/msgpack';
import { getOrElseW } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { Observable, Subject, distinctUntilChanged } from 'rxjs';
import { AudioSamples } from '../common';
import { Project, defaultMeter } from '../ui-common';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private _history: Project[] = [];
  private _current: number = 0;
  private _prevModFusionTag?: string;
  private _prevModTime?: number;
  private _project$ = new Subject<Project>();
  get project$(): Observable<Project> { return this._project$ }
  readonly #projectAudio: WritableSignal<AudioSamples | undefined> = signal(undefined);
  readonly projectAudio = this.#projectAudio.asReadonly();
  private _lastSaved?: Project;
  private _isUnsaved$ = new Subject<boolean>();
  readonly isUnsaved$: Observable<boolean> = this._isUnsaved$.pipe(distinctUntilChanged());

  // invariant: _project.length == 0 || 0 <= _current < _project.length

  // TODO: this being optional is too annoying
  get project(): Project | undefined { return this._history.length ? this._history[this._current] : undefined }

  private _onChange(ft?: string, mt?: number) {
    this._prevModFusionTag = ft;
    this._prevModTime = mt;
    this._project$.next(this.project!);
    this._isUnsaved$.next(!Object.is(this.project, this._lastSaved));
  }

  newProject(audioFile: Uint8Array, audio: AudioSamples) {
    this._history = [{ audioFile, audio, meter: defaultMeter, parts: [] }];
    this._current = 0;
    this._onChange();
    this.#projectAudio.set(audio);
  }

  async fromBlob(blob: Blob) {
    const proj = pipe(
      Project.decode(await msgpack.decodeAsync(blob.stream()) as any),
      getOrElseW((e) => { console.log("fromBlob:", e); throw new Error(`${e[0].context.at(-1)?.key}:${e[0].value}`); })
    );
    this._history = [proj];
    this._current = 0;
    this._onChange();
    this.#projectAudio.set(proj.audio);
  }

  intoBlob(): Blob {
    if (!this.project) throw new Error("cannot serialize non-existant project");
    return new Blob([msgpack.encode(Project.encode(this.project))]);
  }

  /** if the previous modification had the same fusion tag, a new undo state may not be created */
  modify(op: (a: Project) => Project, fusionTag?: string) {
    if (!this.project) return;
    const next = op(this.project);
    const modTime = performance.now();
    if (
      this._prevModFusionTag !== undefined
      && this._prevModFusionTag === fusionTag // implies `fusionTag !== undefined`
      && this._prevModTime !== undefined
      && modTime - this._prevModTime <= MAX_FUSION_TIMEOUT
    ) {
      this._history[this._current] = next;
    } else {
      this._current++;
      this._history.splice(this._current);
      this._history.push(next);
    }
    // always reset timestamp to allow "chaining" changes
    this._onChange(fusionTag, modTime);
  }

  canUndo() { return this._current >= 1 }

  undo() {
    if (!this.canUndo()) return;
    this._current--;
    this._onChange();
  }

  canRedo() { return this._current + 1 <= this._history.length - 1 }

  redo() {
    if (!this.canRedo()) return;
    this._current++;
    this._onChange();
  }

  markSaved() {
    if (!this.project) return;
    this._lastSaved = this.project;
    this._isUnsaved$.next(false);
  }
}

/** if two modifications are more than this many milliseconds apart, they will not be merged */
const MAX_FUSION_TIMEOUT: DOMHighResTimeStamp = 1000;
