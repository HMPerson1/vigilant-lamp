import { CdkScrollable } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { Writable } from 'type-fest';
import { Instruments, Part } from '../../model/project';

@Component({
    selector: 'app-part-dialog',
    templateUrl: './part-dialog.component.html',
    styleUrls: ['./part-dialog.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [FormsModule, MatDialogTitle, CdkScrollable, MatDialogContent, MatFormField, MatLabel, MatInput, MatSelect, MatOption, MatDialogActions, MatButton, MatDialogClose]
})
export class PartDialogComponent {
  readonly add: boolean;
  readonly part: Writable<Part>;
  constructor() {
    const data: { add: boolean, part: Part } = inject(MAT_DIALOG_DATA);
    this.add = data.add;
    this.part = { ...data.part };
  }
  readonly Instruments = Object.values(Instruments);
}
