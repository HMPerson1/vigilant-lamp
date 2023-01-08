import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
// @ts-ignore
import * as wav from 'wav-decoder';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'vigilant-lamp'
  coi = window.crossOriginIsolated
  @ViewChild('spectrogram_canvas') spectrogramCanvas!: ElementRef<HTMLCanvasElement>
  audioWavData?: { sampleRate: number, channelData: ReadonlyArray<Float32Array> };
  /** samples per pixel */
  audioVizScale: number = 400; // TODO: attach to slider

  onFileSelected(event: Event) {
    const fileInput = event.target as HTMLInputElement
    const reader = new FileReader()
    reader.onload = async (e) => {
      this.audioWavData = await wav.decode(e.target!.result as Buffer)
      console.log(this.audioWavData!.channelData.length);
      console.log(this.audioWavData!.channelData[0].length);
    }
    reader.readAsArrayBuffer(fileInput.files![0])
  }
}
