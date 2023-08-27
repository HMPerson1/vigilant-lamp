import { Injectable } from '@angular/core';
import * as msgpack from '@msgpack/msgpack';
import { getOrElseW } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { AudioSamples } from './common';
import { Project } from './ui-common';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private _history: Project[] = [];
  private _current: number = 0;
  private _prevModFusionTag?: string;
  private _prevModTime?: number;

  // invariant: _project.length == 0 || 0 <= _current < _project.length

  get project(): Project | undefined { return this._history.length ? this._history[this._current] : undefined }

  newProject(audioFile: Uint8Array, audio: AudioSamples) {
    this._history = [{ audioFile, audio, bpm: 120, startOffset: 0, timeSignature: [4, 4], parts: [] }];
    this._current = 0;
    this._prevModFusionTag = undefined;
    this._prevModTime = undefined;
  }

  async fromBlob(blob: Blob) {
    this._history = [pipe(
      Project.decode(await msgpack.decodeAsync(blob.stream()) as any),
      getOrElseW((e) => { console.log(e); throw new Error(`${e[0].context.at(-1)?.key}:${e[0].value}`) })
    )];
    this._current = 0;
    this._prevModFusionTag = undefined;
    this._prevModTime = undefined;
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
    this._prevModFusionTag = fusionTag;
    // always reset timestamp to allow "chaining" changes
    this._prevModTime = modTime;
  }

  canUndo() { return this._current >= 1 }

  undo() {
    if (!this.canUndo()) return;
    this._current--;
    // disable fusion after undo
    this._prevModFusionTag = undefined;
    this._prevModTime = undefined;
  }

  canRedo() { return this._current + 1 <= this._history.length - 1 }

  redo() {
    if (!this.canRedo()) return;
    this._current++;
    // disable fusion after redo
    this._prevModFusionTag = undefined;
    this._prevModTime = undefined;
  }
}

/** if two modifications are more than this many milliseconds apart, they will not be merged */
const MAX_FUSION_TIMEOUT: DOMHighResTimeStamp = 1000;
