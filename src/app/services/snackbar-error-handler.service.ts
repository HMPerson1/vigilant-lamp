import { ErrorHandler, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root'
})
export class SnackbarErrorHandlerService implements ErrorHandler {
  constructor(private readonly snackBar: MatSnackBar) { }
  handleError(error: any): void {
    console.error(error);
    this.snackBar.open("An unexpected error has occured.");
  }
}
