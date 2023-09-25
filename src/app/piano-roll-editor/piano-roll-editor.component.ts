import { Component, ElementRef, HostListener, Input, OnChanges, SimpleChanges } from '@angular/core';
import { identity } from 'fp-ts/function';
import * as lodash from 'lodash-es';
import { fromInput } from 'observable-from-input';
import * as rxjs from 'rxjs';
import { GenSpecTile } from '../common';
import { ProjectService } from '../project.service';
import { Meter, Note, PULSES_PER_BEAT, Part, PartLens, ProjectLens, indexReadonlyArray, pulse2time, time2beat, time2pulse } from '../ui-common';

@Component({
  selector: 'app-piano-roll-editor',
  templateUrl: './piano-roll-editor.component.html',
  styleUrls: ['./piano-roll-editor.component.css']
})
export class PianoRollEditorComponent implements OnChanges {
  constructor(readonly project: ProjectService, elemRef: ElementRef<HTMLElement>) {
    const toObs = fromInput(this);
    this.mousePos$ = rxjs.combineLatest([toObs('mouseX'), toObs('mouseY')])
      .pipe(rxjs.map(([x, y]) => x !== undefined && y !== undefined ? [x, y] : undefined));

    this.elemContentRect = elemRef.nativeElement.getBoundingClientRect();
    this.tile = new GenSpecTile(this, this.elemContentRect);
    new ResizeObserver(
      ([{ contentRect }]) => { this.elemContentRect = contentRect; this.ngOnChanges(); }
    ).observe(elemRef.nativeElement);
  }

  ngOnChanges(changes?: SimpleChanges): void {
    if (this.elemContentRect !== undefined && (!changes || ['timeMin', 'timeMax', 'pitchMin', 'pitchMax'].some(x => x in changes))) {
      this.tile = new GenSpecTile(this, this.elemContentRect);
    }
  }

  @Input() timeMin: number = 0;
  @Input() timeMax: number = 30;
  @Input() pitchMin: number = 12;
  @Input() pitchMax: number = 108;
  @Input() mouseX?: number;
  @Input() mouseY?: number;
  private mousePos$: rxjs.Observable<[number, number] | undefined>;
  @Input() activePartIdx?: number;

  private elemContentRect: DOMRect;
  private tile: GenSpecTile<DOMRect>;

  get activePart(): Part | undefined { return this.activePartIdx !== undefined ? this.project.project?.parts?.[this.activePartIdx] : undefined }
  get activePartColor() { return this.activePart?.color }
  get hideSelectedNotes() { return this.resizeNoteState !== undefined || this.draggedNotes !== undefined; }

  hoveredNote(): Note | undefined {
    const meter = this.project.project?.meter;
    if (!meter || this.mouseX === undefined || this.mouseY === undefined) return;

    const subdiv = Math.floor(meter.subdivision * time2beat(meter, this.tile.x2time(this.mouseX)));
    if (subdiv < 0) return;
    const pitch = Math.round(this.tile.y2pitch(this.mouseY));
    return {
      pitch,
      start: subdiv * PULSES_PER_BEAT / meter.subdivision,
      length: PULSES_PER_BEAT / meter.subdivision,
      notation: undefined,
    };
  }

  get notePreviewStyle() {
    if (this.activePartIdx === undefined) return;
    const hoveredNote = this.hoveredNote();
    if (!hoveredNote) return;
    return this.noteStyle(hoveredNote);
  }

  private note2rect(note: Note): Rect | undefined {
    const meter = this.project.project?.meter;
    if (!this.tile || !meter) return;

    const x = Math.round(this.tile.time2x(pulse2time(meter, note.start)));
    const y = Math.round(this.tile.pitch2y(note.pitch + .5));
    return {
      x,
      y,
      width: Math.round(this.tile.time2x(pulse2time(meter, (note.start + note.length)))) - x,
      height: Math.round(this.tile.pitch2y(note.pitch - 0.5)) - y,
    };
  }

  noteStyle(note: Note) {
    const r = this.note2rect(note);
    return r ? rect2style(r) + (r.width < 8 ? `border-inline-width: ${r.width / 2}px` : '') : undefined;
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    if (this.activePartIdx !== undefined) {
      this.startAddNote(event);
    } else {
      this.startSelection(event);
    }
  }

  private clickStartNote?: Note;

  async startAddNote(event: MouseEvent) {
    const activePartIdx = this.activePartIdx;
    if (activePartIdx === undefined) return;
    const hoveredNoteStart = this.hoveredNote();
    if (!hoveredNoteStart) return;

    event.preventDefault();

    this.clickStartNote = hoveredNoteStart;
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
      const hoveredNoteEnd = this.hoveredNote();
      if (!hoveredNoteEnd) return;
      const clickedNote = clickDragNote(hoveredNoteStart, hoveredNoteEnd);
      if (!clickedNote) return;
      this.project.modify(
        ProjectLens(['parts']).compose(indexReadonlyArray(activePartIdx)).compose(PartLens('notes')).modify(
          notes => [...notes, clickedNote]
        )
      )
    } finally {
      this.clickStartNote = undefined;
    }
  }

  get activeNoteStyle() {
    if (!this.clickStartNote) return;
    const hoveredNote = this.hoveredNote();
    if (!hoveredNote) return;
    const activeNote = clickDragNote(this.clickStartNote, hoveredNote);
    return activeNote ? this.noteStyle(activeNote) : undefined;
  }

  selection: Map<number, Set<number>> = new Map();
  singleSelection?: [number, number];

  private selectionStart?: readonly [number, number];

  async startSelection(event: MouseEvent) {
    if (this.activePartIdx !== undefined || this.mouseX === undefined || this.mouseY === undefined) return;
    const project = this.project.project;
    if (project === undefined) return;

    event.preventDefault();

    if (event.shiftKey || event.ctrlKey) {
      // TODO
    }

    this.singleSelection = undefined;
    const selStart = [this.mouseX, this.mouseY] as const;
    this.selectionStart = selStart;
    const onMoveSub = this.mousePos$.pipe(rxjs.map(mousePos => {
      if (!mousePos) return;
      const time0 = time2pulse(project.meter, this.tile.x2time(selStart[0]));
      const time1 = time2pulse(project.meter, this.tile.x2time(mousePos[0]));
      const pitch0 = this.tile.y2pitch(selStart[1]);
      const pitch1 = this.tile.y2pitch(mousePos[1]);
      const selRect = {
        timeMin: Math.min(time0, time1),
        timeMax: Math.max(time0, time1),
        pitchMin: Math.min(pitch0, pitch1) - .5,
        pitchMax: Math.max(pitch0, pitch1) + .5,
      }
      return new Map(function* () {
        for (const [partIdx, part] of project.parts.entries()) {
          const partSeld = new Set(function* () {
            for (const [noteIdx, note] of part.notes.entries()) {
              if (isNoteInRect(selRect, note)) {
                yield noteIdx;
              }
            }
            return;
          }());
          if (partSeld.size > 0) yield [partIdx, partSeld];
        }
        return;
      }());
    })).subscribe(x => this.selection = x ?? new Map());
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
      if (this.selection.size === 1) {
        const p = this.selection.entries().next();
        if (!p.done && p.value[1].size === 1) {
          const n = p.value[1].values().next();
          if (!n.done) {
            this.singleSelection = [p.value[0], n.value];
          }
        }
      }
    } finally {
      this.selectionStart = undefined;
      onMoveSub.unsubscribe();
    }
  }

  get selectionStartRectStyle() {
    if (this.selectionStart === undefined || this.mouseX === undefined || this.mouseY === undefined) return;
    const x = Math.min(this.mouseX, this.selectionStart[0]);
    const xMax = Math.max(this.mouseX, this.selectionStart[0]);
    const y = Math.min(this.mouseY, this.selectionStart[1]);
    const yMax = Math.max(this.mouseY, this.selectionStart[1]);
    return rect2style({ x, y, width: xMax - x, height: yMax - y });
  }

  get selectionResizeIndicatorStyle() {
    if (!this.project.project || this.draggedNotes !== undefined) return;
    let note = this.resizeNote;
    if (this.singleSelection && !note) {
      const [partIdx, noteIdx] = this.singleSelection;
      note = this.project.project.parts[partIdx].notes[noteIdx];
    }
    const noteRect = note && this.note2rect(note);
    return noteRect && rect2style(noteRect);
  }

  resizeNoteState?: [number, number, 0 | 1];

  async startNoteResize(which: 0 | 1, event: MouseEvent) {
    if (!this.singleSelection || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const [partIdx, noteIdx] = this.singleSelection;
    this.resizeNoteState = [partIdx, noteIdx, which];
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
      if (!this.mouseX || !this.project.project) return;
      const origNote = this.project.project.parts[partIdx].notes[noteIdx];
      const newNote = doResizeNote(
        this.project.project.meter,
        origNote,
        which,
        this.tile.x2time(this.mouseX),
      );
      // TODO: this may be confusing? maybe don't make undo state only if the drag was always a no-op
      if (lodash.isEqual(origNote, newNote)) return;
      this.project.modify(ProjectLens(['parts']).compose(indexReadonlyArray(partIdx)).compose(PartLens('notes')).compose(indexReadonlyArray(noteIdx)).set(newNote));
    } finally {
      this.resizeNoteState = undefined;
    }
  }

  get resizeNote() {
    if (!this.resizeNoteState || !this.project.project || !this.tile) return;
    const origNote = this.project.project.parts[this.resizeNoteState[0]].notes[this.resizeNoteState[1]];
    return !this.mouseX ? origNote : doResizeNote(
      this.project.project.meter,
      origNote,
      this.resizeNoteState[2],
      this.tile.x2time(this.mouseX),
    );
  }

  get resizeNoteStyle() {
    const n = this.resizeNote;
    return n && this.noteStyle(n);
  }

  draggedNotes?: ReadonlyArray<readonly [number, ReadonlyArray<Note>]>;

  async onSelectedNoteMouseDown(partIdx: number, noteIdx: number, event: MouseEvent) {
    const project = this.project.project;
    if (!project || event.button !== 0 || this.mouseX === undefined || this.mouseY === undefined) return;
    event.preventDefault();
    event.stopPropagation();

    const dragStartX = this.mouseX;
    const dragStartY = this.mouseY;

    const nextMouseMove = rxjs.firstValueFrom(this.mousePos$.pipe(rxjs.filter(v => !v || v[0] !== dragStartX || v[1] !== dragStartY)));
    const nextMouseUp = rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
    if (await Promise.race([nextMouseUp.then(() => true), nextMouseMove.then(() => false)])) {
      // single click: just select the note
      this.selection = new Map([[partIdx, new Set([noteIdx])]]);
      this.singleSelection = [partIdx, noteIdx];
      return;
    }

    const thisMoveNote = moveNote(project.meter, time2pulse(project.meter, this.tile.x2time(dragStartX)), this.tile.y2pitch(dragStartY))

    const onMoveSub = this.mousePos$.pipe(rxjs.map(pos => {
      if (!pos) return;
      const thisMoveNote2 = thisMoveNote(this.tile, pos[0], pos[1]);
      return Array.from(this.selection, ([partIdx, noteIdxSet]) => [partIdx, Array.from(noteIdxSet, noteIdx =>
        thisMoveNote2(project.parts[partIdx].notes[noteIdx])
      )] as const);
    }
    )).subscribe(x => this.draggedNotes = x);
    try {
      await nextMouseUp;
      if (this.mouseX === undefined || this.mouseY === undefined) return;
      const thisMoveNote2 = thisMoveNote(this.tile, this.mouseX, this.mouseY);
      // TODO: this may be confusing? maybe don't make undo state only if the drag was always a no-op
      if (thisMoveNote2 === identity) return;
      this.project.modify(ProjectLens(['parts']).modify(parts => Array.from(parts, (part, partIdx) => {
        const selPart = this.selection.get(partIdx);
        return !selPart ? part : {
          ...part,
          notes: part.notes.map((note, noteIdx) => !selPart.has(noteIdx) ? note : thisMoveNote2(note))
        };
      })));
    } finally {
      this.draggedNotes = undefined;
      onMoveSub.unsubscribe();
    }
  }

  trackIdx(idx: number, _item: unknown) { return idx }
}

const clickDragNote = (start: Note, end: Note): Note | undefined => {
  const length = end.start + end.length - start.start;
  return length > 0 ? { ...start, length, pitch: end.pitch } : undefined;
};

const doResizeNote = (meter: Meter, origNote: Note, which: 0 | 1, time: number): Note => {
  const ppsd = PULSES_PER_BEAT / meter.subdivision;

  const mousePulseRaw = time2pulse(meter, time);
  const mousePulse = Math.round(mousePulseRaw / ppsd) * ppsd;
  const newNoteT1 = origNote.start + (1 - which) * origNote.length;
  const newNoteT2 = mousePulse !== newNoteT1 ? mousePulse
    : mousePulse + ppsd * (mousePulseRaw >= newNoteT1 ? +1 : -1);

  return newNoteT2 >= newNoteT1
    ? { ...origNote, start: newNoteT1, length: newNoteT2 - newNoteT1 }
    : { ...origNote, start: newNoteT2, length: newNoteT1 - newNoteT2 };
}

const moveNote = (meter: Meter, startPulse: number, startPitch: number) => {
  const ppsd = PULSES_PER_BEAT / meter.subdivision;
  return (tile: GenSpecTile<DOMRect>, endX: number, endY: number) => {
    const deltaPulse = Math.round((time2pulse(meter, tile.x2time(endX)) - startPulse) / ppsd) * ppsd;
    const deltaPitch = Math.round(tile.y2pitch(endY) - startPitch);
    return deltaPulse === 0 && deltaPitch === 0 ? identity : (note: Note): Note => ({
      ...note,
      start: note.start + deltaPulse,
      pitch: note.pitch + deltaPitch,
    });
  };
}

type Rect = { x: number; y: number; width: number; height: number; };
const rect2style = ({ x, y, width, height }: Rect) =>
  `transform: translate(${x}px,${y}px); width: ${width}px; height: ${height}px;`;

const isNoteInRect = (rect: Record<'timeMin' | 'timeMax' | 'pitchMin' | 'pitchMax', number>, note: Note) =>
  (rect.pitchMin <= note.pitch && note.pitch <= rect.pitchMax)
  && (rect.timeMin <= note.start + note.length && note.start <= rect.timeMax)
