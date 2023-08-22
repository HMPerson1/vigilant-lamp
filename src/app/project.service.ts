import { Injectable } from '@angular/core';
import { AudioSamples } from './common';
import { Project } from './ui-common';
import * as msgpack from '@msgpack/msgpack';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private _project: Project[] = [];
  private _current: number = 0;

  // invariant: _project.length == 0 || 0 <= _current < _project.length

  get project(): Project | undefined { return this._project.length ? this._project[this._current] : undefined; }

  newProject(audioFile: ArrayBuffer, audio: AudioSamples) {
    this._project = [new Project(audioFile, audio, 120, 0, [])]
    this._current = 0;
  }

  async fromBlob(blob: Blob) {
    this._project = [Project.fromPrim(await msgpack.decodeAsync(blob.stream()) as any)]
    this._current = 0;
    console.log(this.project);
  }

  intoBlob(): Blob {
    if (!this.project) throw new Error("cannot serialize non-existant project")
    return new Blob([msgpack.encode(this.project.intoPrim())])
  }

  modify(op: (a: Project) => Project) {
    if (!this.project) return;
    const next = op(this.project);
    this._current++;
    this._project.splice(this._current);
    this._project.push(next);
  }

  canUndo() {
    return this._current - 1 > 0;
  }

  undo() {
    if (!this.canUndo()) return;
    this._current--;
  }

  canRedo() {
    return this._current + 1 <= this._project.length - 1;
  }

  redo() {
    if (!this.canRedo()) return;
    this._current++;
  }
}
