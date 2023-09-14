import { Component, ElementRef, Input, OnChanges, SimpleChanges } from '@angular/core';
import { GenSpecTile } from '../common';
import { ProjectService } from '../project.service';
import { Note, PULSES_PER_BEAT, Part, PartLens, ProjectLens, indexReadonlyArray, pulse2time, time2beat } from '../ui-common';

@Component({
  selector: 'app-piano-roll-editor',
  templateUrl: './piano-roll-editor.component.html',
  styleUrls: ['./piano-roll-editor.component.css']
})
export class PianoRollEditorComponent implements OnChanges {
  constructor(readonly project: ProjectService, private readonly elemRef: ElementRef<HTMLElement>) {
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
  @Input() partIdx?: number;

  private elemContentRect: DOMRect;
  private tile: GenSpecTile<DOMRect>;

  get part(): Part | undefined { return this.partIdx !== undefined ? this.project.project?.parts?.[this.partIdx] : undefined }

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
    const part = this.part;
    if (!part) return;
    const hoveredNote = this.hoveredNote();
    if (!hoveredNote) return;
    return this.noteStyle(hoveredNote) + ` background-color: ${part.color};`;
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

  onClick(_event: MouseEvent) {
    const part = this.part;
    if (!part) return;
    const hoveredNote = this.hoveredNote();
    if (!hoveredNote) return;
    this.project.modify(ProjectLens(['parts']).compose(indexReadonlyArray(this.partIdx!)).compose(PartLens('notes')).modify(
      notes => [...notes, hoveredNote]
    ))
  }
}
