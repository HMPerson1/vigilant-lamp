import { Component, ElementRef, Input } from '@angular/core';
import { GenSpecTile } from '../common';
import { ProjectService } from '../project.service';
import { Part, beat2time, time2beat } from '../ui-common';

@Component({
  selector: 'app-piano-roll-editor',
  templateUrl: './piano-roll-editor.component.html',
  styleUrls: ['./piano-roll-editor.component.css']
})
export class PianoRollEditorComponent {
  constructor(private readonly project: ProjectService, private readonly elemRef: ElementRef<HTMLElement>) { }

  @Input() timeMin: number = 0;
  @Input() timeMax: number = 30;
  @Input() pitchMin: number = 12;
  @Input() pitchMax: number = 108;
  @Input() mouseX?: number;
  @Input() mouseY?: number;
  @Input() partIdx?: number;

  get part(): Part | undefined { return this.partIdx !== undefined ? this.project.project?.parts?.[this.partIdx] : undefined }

  get notePreviewStyle() {
    const part = this.part;
    const meter = this.project.project?.meter;
    if (!part || !meter || this.mouseX === undefined || this.mouseY === undefined) return;

    const tile = new GenSpecTile(this, this.elemRef.nativeElement.getBoundingClientRect());
    const subdiv = Math.floor(meter.subdivision * time2beat(meter, tile.x2time(this.mouseX)));
    if (subdiv < 0) return;
    const pitch = Math.round(tile.y2pitch(this.mouseY));

    const x = Math.round(tile.time2x(beat2time(meter, subdiv / meter.subdivision)));
    const y = Math.round(tile.pitch2y(pitch + .5));
    const width = Math.round(tile.time2x(beat2time(meter, (subdiv + 1) / meter.subdivision))) - x;
    const height = Math.round(tile.pitch2y(pitch - .5)) - y;
    return `transform: translate(${x}px,${y}px); width: ${width}px; height: ${height}px;`
  }
}
