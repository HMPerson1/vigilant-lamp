import { ChangeDetectionStrategy, Component, ElementRef, Input, ViewChild, WritableSignal, computed, effect, signal } from '@angular/core';
import { midiToNoteName } from '@tonaljs/midi';
import * as lodash from 'lodash-es';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { GenSpecTile, SpecTileWindow } from '../common';
import { Meter, PitchLabelType, beat2time, elemBoxSizeSignal, time2beat } from '../ui-common';

@Component({
  selector: 'app-spectrogram-grids',
  templateUrl: './spectrogram-grids.component.html',
  styleUrls: ['./spectrogram-grids.component.css'],
  styles: [':host{ display:block; position:absolute; inset:0; pointer-events:none }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpectrogramGridsComponent {
  readonly #showPitchGrid$ = signal(false);
  @Input() set showPitchGrid(v: boolean) { this.#showPitchGrid$.set(v) }
  readonly #pitchLabelType$: WritableSignal<PitchLabelType> = signal('sharp');
  @Input() set pitchLabelType(v: PitchLabelType) { this.#pitchLabelType$.set(v) }


  readonly _showOvertones$ = signal(true);
  @Input() set showOvertones(v: boolean) { this._showOvertones$.set(v) }

  @Input() set meter(x: Partial<Meter> | undefined) { this.#meter$.set(x ?? undefined) }
  readonly #meter$: WritableSignal<Partial<Meter> | undefined> = signal(undefined);

  @ViewChild('canvas') set canvasChildElem(v: ElementRef<HTMLCanvasElement>) { this.#canvas.set(v.nativeElement) }
  readonly #canvas = signal<HTMLCanvasElement | undefined>(undefined);

  constructor(private readonly viewport: AudioVisualizationComponent, hostElem: ElementRef<HTMLElement>) {
    const canvasSize = elemBoxSizeSignal(hostElem.nativeElement, 'device-pixel-content-box');
    const viewportParams = computed<SpecTileWindow>(() => ({
      timeMin: viewport.timeMin(), timeMax: viewport.timeMax(),
      pitchMin: viewport.pitchMin(), pitchMax: viewport.pitchMax(),
    }));

    effect(() => {
      const canvas = this.#canvas();
      if (canvas === undefined) return;
      canvas.width = canvasSize().inlineSize;
      canvas.height = canvasSize().blockSize;
      const canvasCtx = canvas.getContext('2d', { alpha: true })!;
      canvasCtx.imageSmoothingEnabled = false;
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      const canvasTile = new GenSpecTile(viewportParams(), canvas);
      this.renderPitchGrid(canvasTile, canvasCtx);
      this.renderBeatGrid(canvasTile, canvasCtx);
    })
  }

  renderPitchGrid(canvasTile: SpecTileCanvas, canvasCtx: CanvasRenderingContext2D) {
    const pitchMinInt = Math.floor(canvasTile.pitchMin);
    const pitchMaxInt = Math.ceil(canvasTile.pitchMax);
    const forEachPitch = (f: (pitch: number) => void) => {
      for (let pitch = pitchMinInt; pitch <= pitchMaxInt; pitch++) {
        f(pitch)
      }
    }

    canvasCtx.save();
    canvasCtx.lineWidth = 1;
    canvasCtx.translate(0, 0.5);

    if (this.#showPitchGrid$()) {
      const pitchLines = (offset: number) => {
        canvasCtx.beginPath();
        forEachPitch((p) => {
          const y = Math.floor(canvasTile.pitch2y(p + offset));
          canvasCtx.moveTo(0, y);
          canvasCtx.lineTo(canvasTile.width, y);
        });
        canvasCtx.stroke();
      };

      canvasCtx.save();
      canvasCtx.strokeStyle = PITCH_GRID_BORDER;
      pitchLines(-.5);
      canvasCtx.restore();

      if (canvasTile.pixelsPerPitch > 30) {
        canvasCtx.save();
        canvasCtx.strokeStyle = PITCH_GRID_CENTER;
        canvasCtx.setLineDash([4, 4])
        pitchLines(0);
        canvasCtx.restore();
      }
    }

    const label = this.#pitchLabelType$();
    if (label != 'none') {
      canvasCtx.save();
      canvasCtx.shadowColor = 'black';
      canvasCtx.shadowBlur = 3;
      canvasCtx.textBaseline = 'alphabetic';
      const fontSize = lodash.clamp(Math.round(.8 * canvasTile.pixelsPerPitch), 12, 20);
      canvasCtx.font = `${fontSize}px sans-serif`
      const textMetrics = canvasCtx.measureText("");
      forEachPitch((pitch) => {
        const pitchStr = pitchLabel(label, pitch);
        const textHeight = textMetrics.fontBoundingBoxAscent + textMetrics.fontBoundingBoxDescent;
        const textBaseline = canvasTile.pitch2y(pitch) - .5 + textMetrics.fontBoundingBoxAscent - textHeight / 2;
        canvasCtx.fillStyle = 'black';
        canvasCtx.fillText(pitchStr, 1, textBaseline);
        canvasCtx.fillText(pitchStr, 1, textBaseline);
        canvasCtx.fillStyle = 'white';
        canvasCtx.fillText(pitchStr, 1, textBaseline);
      })
      canvasCtx.restore();
    }

    canvasCtx.restore();
  }

  renderBeatGrid(canvasTile: SpecTileCanvas, canvasCtx: CanvasRenderingContext2D) {
    const meter = this.#meter$();
    if (meter === undefined) {
      return;
    } else if (meter.startOffset !== undefined && meter.bpm === undefined) {
      canvasCtx.save();
      canvasCtx.translate(0.5, 0);
      canvasCtx.strokeStyle = BEAT_GRID_BEAT_LINE;
      canvasCtx.beginPath();
      const x = Math.round(canvasTile.time2x(meter.startOffset));
      canvasCtx.moveTo(x, 0);
      canvasCtx.lineTo(x, canvasTile.height);
      canvasCtx.stroke();
      canvasCtx.restore();
      return;
    } else if (!Meter.is(meter)) {
      return;
    }

    canvasCtx.save();
    canvasCtx.translate(0.5, 0);

    const timePerPx = 1 / canvasTile.pixelsPerTime;
    const windowLeftBeat = time2beat(meter, canvasTile.timeMin - timePerPx);
    const windowRightBeat = time2beat(meter, canvasTile.timeMax + timePerPx);
    const beatLines = (scale: number, skip: number) => {
      const first = Math.max(Math.ceil(windowLeftBeat / scale), 0);
      const last = Math.floor(windowRightBeat / scale);

      if (last - first > 2000) {
        console.warn("beat grid too dense!", canvasTile, meter);
        return;
      }

      canvasCtx.beginPath();
      for (let l = first; l <= last; l++) {
        if (l % skip === 0) continue;
        const x = Math.round(canvasTile.time2x(beat2time(meter, l * scale)));
        canvasCtx.moveTo(x, 0);
        canvasCtx.lineTo(x, canvasTile.height);
      }
      canvasCtx.stroke();
    }

    canvasCtx.save();
    canvasCtx.strokeStyle = BEAT_GRID_MEASURE_LINE;
    beatLines(meter.measureLength, Infinity);
    canvasCtx.restore();

    const pixelsPerBeat = canvasTile.pixelsPerTime * 60 / meter.bpm;
    if (pixelsPerBeat > 10) {
      canvasCtx.save();
      canvasCtx.strokeStyle = BEAT_GRID_BEAT_LINE;
      beatLines(1, meter.measureLength);
      canvasCtx.restore();

      if (pixelsPerBeat > 100) {
        canvasCtx.save();
        canvasCtx.setLineDash([1, 1]);
        canvasCtx.strokeStyle = BEAT_GRID_BEAT_LINE;
        beatLines(1 / meter.subdivision, meter.subdivision);
        canvasCtx.restore();
      }
    }

    canvasCtx.restore();
  }

  overtoneYOffsets = computed(() => {
    const pxPerPitch = this.viewport.pxPerPitch();
    const s = this.viewport.viewportSize();
    return Array.from({ length: 7 }, (_x, i) => `translateY(${s.blockSize - Math.ceil(Math.log2(i + 2) * 12 * pxPerPitch)}px)`);
  });
  overtoneContainerTransform = computed(() => {
    const ox = this.viewport.viewportOffsetX();
    const oy = this.viewport.viewportOffsetY() + (this.viewport.visMouseY() ?? 0) - this.viewport.viewportSize().blockSize;
    return `translate(${ox}px,${oy}px)`;
  });

  readonly canvasBoxTransform = computed(() => `translate(${this.viewport.viewportOffsetX()}px,${this.viewport.viewportOffsetY()}px)`);
  trackIdx(idx: number, _item: any) { return idx }
}

function pitchLabel(label: PitchLabelType, pitch: number): string {
  if (label === 'midi') return `${pitch}`;
  if (pitch < 0) return "";
  return midiToNoteName(pitch, { sharps: label === 'sharp' }).replace('#', '♯').replace('b', '♭');
}

type SpecTileCanvas = GenSpecTile<HTMLCanvasElement>;

const PITCH_GRID_BORDER = '#808080FF'
const PITCH_GRID_CENTER = '#80808080'
const BEAT_GRID_BEAT_LINE = '#00CC0080';
const BEAT_GRID_MEASURE_LINE = '#00CC00FF';
