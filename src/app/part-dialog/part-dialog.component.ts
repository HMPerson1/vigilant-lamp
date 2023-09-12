import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Writable } from 'type-fest';
import { Instruments, Part } from '../ui-common';

@Component({
  selector: 'app-part-dialog',
  templateUrl: './part-dialog.component.html',
  styleUrls: ['./part-dialog.component.css']
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
