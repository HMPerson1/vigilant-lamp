import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TranscribePanelComponent } from './transcribe-panel.component';

describe('TranscribePanelComponent', () => {
  let component: TranscribePanelComponent;
  let fixture: ComponentFixture<TranscribePanelComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [TranscribePanelComponent]
    });
    fixture = TestBed.createComponent(TranscribePanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
