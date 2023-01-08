import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatSliderModule } from '@angular/material/slider';

import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { AudioWaveformComponent } from './audio-waveform/audio-waveform.component';

@NgModule({
  declarations: [
    AppComponent,
    AudioWaveformComponent
  ],
  imports: [
    MatSliderModule,
    MatButtonModule,
    BrowserModule,
    BrowserAnimationsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
