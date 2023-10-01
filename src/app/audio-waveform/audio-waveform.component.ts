import { Component, DestroyRef, ElementRef, ViewChild, computed, effect } from '@angular/core';
import * as wasm_module from '../../../wasm/pkg';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { ProjectService } from '../services/project.service';
import { imageDataToBitmapFast, resizeSignal } from '../ui-common';

@Component({
  selector: 'app-audio-waveform',
  template: '<canvas #waveform_canvas></canvas>',
  host: { class: 'canvas-box' },
})
export class AudioWaveformComponent {
  #waveCanvasCtx?: ImageBitmapRenderingContext;
  @ViewChild('waveform_canvas') set waveformCanvas(canvas: ElementRef<HTMLCanvasElement>) {
    this.#waveCanvasCtx = canvas.nativeElement.getContext('bitmaprenderer', { alpha: false })!
    this.#waveCanvasCtx.transferFromImageBitmap(null);
  }

  constructor(project: ProjectService, audioVizContainer: AudioVisualizationComponent, hostElem: ElementRef<HTMLElement>, destroyRef: DestroyRef) {
    const wasmWaveRenderer$ = (() => {
      let lastRenderer: wasm_module.WaveformRenderer | undefined;
      destroyRef.onDestroy(() => {
        lastRenderer?.free();
        lastRenderer = undefined;
      });
      return computed(() => {
        lastRenderer?.free();
        const audioData = project.projectAudio();
        lastRenderer = audioData && new wasm_module.WaveformRenderer(new wasm_module.AudioBuffer(audioData.samples, audioData.sampleRate));
        return lastRenderer;
      });
    })();

    const size$ = resizeSignal(hostElem.nativeElement, { box: 'device-pixel-content-box' })

    effect(async () => {
      const size = size$();
      const wasmWaveRenderer = wasmWaveRenderer$();
      if (!this.#waveCanvasCtx || !size || !wasmWaveRenderer) return;

      const [{ blockSize, inlineSize }] = size.devicePixelContentBoxSize;
      const imageData = wasmWaveRenderer.render(audioVizContainer.timeMin(), audioVizContainer.timeMax(), inlineSize, blockSize);
      this.#waveCanvasCtx.transferFromImageBitmap(await imageDataToBitmapFast(imageData));
    });
  }


  // onWheel(event: WheelEvent) {
  //   if (!this.waveformCanvas) {
  //     console.error("scroll event before view rendered???");
  //     return
  //   }
  //   const waveCanvas = this.waveformCanvas.nativeElement;
  //   event.preventDefault()
  //   // TODO: scroll pixel/line/page ???

  //   const delta = event.deltaX + event.deltaY
  //   if (delta) {
  //     doScrollZoomTime(
  //       this, 'timeMin', 'timeMax', this.audioData ? audioSamplesDuration(this.audioData) : 30,
  //       delta, event.ctrlKey, event.offsetX / waveCanvas.clientWidth
  //     )
  //     this.timeMinChange.emit(this.timeMin)
  //     this.timeMaxChange.emit(this.timeMax)
  //   }
  // }
}
