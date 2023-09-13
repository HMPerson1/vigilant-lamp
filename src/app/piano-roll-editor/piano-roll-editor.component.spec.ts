import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PianoRollEditorComponent } from './piano-roll-editor.component';

describe('PianoRollEditorComponent', () => {
  let component: PianoRollEditorComponent;
  let fixture: ComponentFixture<PianoRollEditorComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PianoRollEditorComponent]
    });
    fixture = TestBed.createComponent(PianoRollEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
