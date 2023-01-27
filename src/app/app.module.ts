import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { BrowserModule } from '@angular/platform-browser';


import { FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { AppComponent } from './app.component';
import { AudioSpectrogramComponent } from './audio-spectrogram/audio-spectrogram.component';
import { AudioWaveformComponent } from './audio-waveform/audio-waveform.component';

@NgModule({
  declarations: [
    AppComponent,
    AudioWaveformComponent,
    AudioSpectrogramComponent
  ],
  imports: [
    FormsModule,
    MatSlideToggleModule,
    MatIconModule,
    MatSliderModule,
    MatButtonModule,
    BrowserModule,
    BrowserAnimationsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
