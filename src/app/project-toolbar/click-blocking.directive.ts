import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Directive, ElementRef, input, signal } from '@angular/core';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Directive({
    selector: 'button[appClickBlocking]',
    host: {
        '(click)': "onClick($event)",
        '[disabled]': "cbDisabled() || taskActive()",
    }
})
export class ClickBlockingDirective {
  readonly appClickBlocking = input.required<(e: MouseEvent) => Promise<void>>();
  readonly cbDisabled = input(false);
  readonly taskActive = signal(false);

  private readonly overlayPositionStrategy;

  constructor(private readonly hostElem: ElementRef<HTMLElement>, private readonly overlay: Overlay) {
    this.overlayPositionStrategy = overlay.position().flexibleConnectedTo(hostElem)
      .withPositions([{ originX: 'center', originY: 'center', overlayX: 'center', overlayY: 'center' }]);
  }

  async onClick(event: MouseEvent) {
    const overlayRef = this.overlay.create({ positionStrategy: this.overlayPositionStrategy });
    const spinnerRef = overlayRef.attach(spinnerPortal);
    spinnerRef.setInput('mode', 'indeterminate');
    const hostRect = this.hostElem.nativeElement.getBoundingClientRect();
    spinnerRef.setInput('diameter', Math.max(16, Math.min(hostRect.width, hostRect.height)) - 8);
    try {
      this.taskActive.set(true);
      await this.appClickBlocking()(event);
    } finally {
      this.taskActive.set(false);
      spinnerRef.destroy();
      overlayRef.dispose();
    }
  }
}

const spinnerPortal = new ComponentPortal(MatProgressSpinner);
