import { Component, DestroyRef, ElementRef, ViewChild, computed, effect } from '@angular/core';
import * as wasm_module from '../../../wasm/pkg';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { ProjectService } from '../services/project.service';
import { elemBoxSizeSignal, imageDataToBitmapFast } from '../ui-common';

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
        lastRenderer = undefined;
        const audioData = project.projectAudio();
        if (audioData !== undefined) {
          console.log('new data');
          const wasmBuffer = new wasm_module.AudioBuffer(audioData.samples, audioData.sampleRate);
          lastRenderer = new wasm_module.WaveformRenderer(wasmBuffer);
          wasmBuffer.free();
        }
        return lastRenderer;
      });
    })();

    const size = elemBoxSizeSignal(hostElem.nativeElement, 'device-pixel-content-box');

    effect(async () => {
      const wasmWaveRenderer = wasmWaveRenderer$();
      if (!this.#waveCanvasCtx || !wasmWaveRenderer) return;

      const { blockSize, inlineSize } = size();
      const imageData = wasmWaveRenderer.render(audioVizContainer.timeMin(), audioVizContainer.timeMax(), inlineSize, blockSize);
      this.#waveCanvasCtx.transferFromImageBitmap(await imageDataToBitmapFast(imageData));
    });
  }
}
