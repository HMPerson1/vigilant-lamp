import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpectrogramContainerComponent } from './spectrogram-container.component';

describe('SpectrogramContainerComponent', () => {
  let component: SpectrogramContainerComponent;
  let fixture: ComponentFixture<SpectrogramContainerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SpectrogramContainerComponent]
    });
    fixture = TestBed.createComponent(SpectrogramContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
