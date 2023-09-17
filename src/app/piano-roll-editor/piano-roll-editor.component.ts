import { Component, ElementRef, HostListener, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as rxjs from 'rxjs';
import { Writable } from 'type-fest';
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
  @Input() activePartIdx?: number;

  private elemContentRect: DOMRect;
  private tile: GenSpecTile<DOMRect>;

  get activePart(): Part | undefined { return this.activePartIdx !== undefined ? this.project.project?.parts?.[this.activePartIdx] : undefined }
  get activePartColor() { return this.activePart?.color }

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
    return r ? rect2style(r) : undefined;
  }

  clickStartNote?: Writable<Note>;

  @HostListener('mousedown', ['$event'])
  async onMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
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

  onNoteClicked(partIdx: number, noteIdx: number, event: MouseEvent) {
    if (event.shiftKey) {
    } else {
      this.selection = new Map([[partIdx, new Set([noteIdx])]]);
      this.singleSelection = [partIdx, noteIdx];
    }
  }

  selectionResizeHandleStyle(which: 0 | 1) {
    if (!this.singleSelection || !this.project.project) return;
    const [partIdx, noteIdx] = this.singleSelection;
    const noteRect = this.note2rect(this.project.project.parts[partIdx].notes[noteIdx]);
    if (!noteRect) return;
    return rect2style({
      x: noteRect.x - (RESIZE_HANDLE_WIDTH / 2) + which * noteRect.width,
      y: noteRect.y,
      width: RESIZE_HANDLE_WIDTH,
      height: noteRect.height,
    });
  }

  resizeNote?: [number, number, 0 | 1];

  async startNoteResize(which: 0 | 1, event: MouseEvent) {
    if (!this.singleSelection || event.button !== 0) return;
    event.preventDefault();
    const [partIdx, noteIdx] = this.singleSelection;
    this.resizeNote = [partIdx, noteIdx, which];
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
      if (!this.mouseX || !this.project.project) return;
      this.project.modify(ProjectLens(['parts']).compose(indexReadonlyArray(partIdx)).compose(PartLens('notes')).compose(indexReadonlyArray(noteIdx)).modify(n => resizeNote(
        this.project.project!.meter,
        n,
        which,
        this.tile.x2time(this.mouseX!),
      )));
    } finally {
      this.resizeNote = undefined;
    }
  }

  get resizeNoteStyle() {
    if (!this.resizeNote || !this.project.project || !this.tile) return;
    const origNote = this.project.project.parts[this.resizeNote[0]].notes[this.resizeNote[1]];
    if (!this.mouseX) return this.noteStyle(origNote);
    const meter = this.project.project.meter;
    return this.noteStyle(resizeNote(
      meter,
      origNote,
      this.resizeNote[2],
      this.tile.x2time(this.mouseX),
    ));
  }
}

const clickDragNote = (start: Note, end: Note): Note | undefined => {
  const length = end.start + end.length - start.start;
  return length > 0 ? { ...start, length, pitch: end.pitch } : undefined;
};

const resizeNote = (meter: Meter, origNote: Note, which: 0 | 1, time: number): Note => {
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

type Rect = { x: number; y: number; width: number; height: number; };
const rect2style = ({ x, y, width, height }: Rect) =>
  `transform: translate(${x}px,${y}px); width: ${width}px; height: ${height}px;` + (width < 8 ? `border-inline-width: ${width / 2}px` : '');

const RESIZE_HANDLE_WIDTH = 8;
