import { DragDropModule } from '@angular/cdk/drag-drop';
import { PortalModule } from '@angular/cdk/portal';
import { ErrorHandler, NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { ErrorStateMatcher, MatRippleModule, ShowOnDirtyErrorStateMatcher } from '@angular/material/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS, MatSnackBarModule } from '@angular/material/snack-bar';
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipModule } from '@angular/material/tooltip';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { AppComponent } from './app.component';
import { AudioPlayerComponent } from './audio-player/audio-player.component';
import { AudioSpectrogramComponent } from './audio-spectrogram/audio-spectrogram.component';
import { AudioVisualizationComponent } from './audio-visualization/audio-visualization.component';
import { AudioWaveformComponent } from './audio-waveform/audio-waveform.component';
import { MeterSettingsPanelComponent } from './meter-settings-panel/meter-settings-panel.component';
import { PartDialogComponent } from './part-dialog/part-dialog.component';
import { PianoRollEditorComponent } from './piano-roll-editor/piano-roll-editor.component';
import { SpectrogramGridsComponent } from './spectrogram-grids/spectrogram-grids.component';
import { SnackbarErrorHandlerService } from './transcribe-panel/snackbar-error-handler.service';
import { TranscribePanelComponent } from './transcribe-panel/transcribe-panel.component';

@NgModule({
  declarations: [
    AppComponent,
    AudioWaveformComponent,
    AudioSpectrogramComponent,
    AudioPlayerComponent,
    MeterSettingsPanelComponent,
    SpectrogramGridsComponent,
    TranscribePanelComponent,
    PartDialogComponent,
    PianoRollEditorComponent,
    AudioVisualizationComponent
  ],
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatButtonToggleModule,
    MatSlideToggleModule,
    MatIconModule,
    MatSliderModule,
    MatButtonModule,
    MatTooltipModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatExpansionModule,
    MatSidenavModule,
    MatCardModule,
    MatMenuModule,
    MatSelectModule,
    MatRippleModule,
    PortalModule,
    DragDropModule,
    BrowserModule,
    BrowserAnimationsModule
  ],
  providers: [
    { provide: MAT_SNACK_BAR_DEFAULT_OPTIONS, useValue: { duration: 5000, horizontalPosition: "end" } },
    { provide: ErrorStateMatcher, useClass: ShowOnDirtyErrorStateMatcher },
    { provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: { showDelay: 500 } },
    { provide: ErrorHandler, useClass: SnackbarErrorHandlerService },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
