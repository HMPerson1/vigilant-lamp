import { Component, ElementRef, HostListener, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as rxjs from 'rxjs';
import { Writable } from 'type-fest';
import { GenSpecTile } from '../common';
import { ProjectService } from '../project.service';
import { Note, PULSES_PER_BEAT, Part, PartLens, ProjectLens, indexReadonlyArray, pulse2time, time2beat } from '../ui-common';

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

  noteStyle(note: Note) {
    const meter = this.project.project?.meter;
    if (!this.tile || !meter) return;
    const x = Math.round(this.tile.time2x(pulse2time(meter, note.start)));
    const y = Math.round(this.tile.pitch2y(note.pitch + .5));
    const width = Math.round(this.tile.time2x(pulse2time(meter, (note.start + note.length)))) - x;
    const height = Math.round(this.tile.pitch2y(note.pitch - .5)) - y;
    return `transform: translate(${x}px,${y}px); width: ${width}px; height: ${height}px;`
  }

  clickStartNote?: Writable<Note>;

  @HostListener('mousedown', ['$event'])
  async onMouseDown(event: MouseEvent) {
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
}

const clickDragNote = (start: Note, end: Note): Note | undefined => {
  const length = end.start + end.length - start.start;
  return length > 0 ? { ...start, length, pitch: end.pitch } : undefined;
};
