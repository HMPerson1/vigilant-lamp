import { Component, signal } from '@angular/core';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';

@Component({
  selector: 'app-spectrogram-container',
  templateUrl: './spectrogram-container.component.html',
  styleUrls: ['./spectrogram-container.component.css'],
  providers: [{ provide: SpectrogramContainerComponent, useExisting: SpectrogramContainerComponent }],
})
export class SpectrogramContainerComponent {
  #pitchMin = signal(12);
  #pitchMax = signal(108);

  #visMouseX = signal<number | undefined>(undefined);
  #visMouseY = signal<number | undefined>(undefined);

  timeMin = this.audioVizContainer.timeMin;
  timeMax = this.audioVizContainer.timeMin;
  pitchMin = this.#pitchMin.asReadonly();
  pitchMax = this.#pitchMax.asReadonly();
  /** offset space of `visElem` */
  visMouseX = this.#visMouseX.asReadonly();
  /** offset space of `visElem` */
  visMouseY = this.#visMouseY.asReadonly();

  constructor(private readonly audioVizContainer: AudioVisualizationComponent) { }
}
