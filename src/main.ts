import { ErrorHandler, enableProdMode } from '@angular/core';
import { ErrorStateMatcher, ShowOnDirtyErrorStateMatcher } from '@angular/material/core';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { SnackbarErrorHandlerService } from './app/services/snackbar-error-handler.service';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
    providers: [
        // importProvidersFrom(FormsModule, ReactiveFormsModule, MatProgressSpinnerModule, MatDividerModule, MatButtonToggleModule, MatSlideToggleModule, MatIconModule, MatSliderModule, MatButtonModule, MatTooltipModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSnackBarModule, MatExpansionModule, MatSidenavModule, MatCardModule, MatMenuModule, MatSelectModule, MatRippleModule, PortalModule, DragDropModule, BrowserModule, BrowserAnimationsModule),
        { provide: MAT_SNACK_BAR_DEFAULT_OPTIONS, useValue: { duration: 5000, horizontalPosition: "end" } },
        { provide: ErrorStateMatcher, useClass: ShowOnDirtyErrorStateMatcher },
        { provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: { showDelay: 500 } },
        { provide: ErrorHandler, useClass: SnackbarErrorHandlerService },
        { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-outlined' } }
    ]
})
  .catch(err => console.error(err));
