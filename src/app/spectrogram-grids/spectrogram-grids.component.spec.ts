import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpectrogramGridsComponent } from './spectrogram-grids.component';

describe('SpectrogramGridsComponent', () => {
  let component: SpectrogramGridsComponent;
  let fixture: ComponentFixture<SpectrogramGridsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SpectrogramGridsComponent]
    });
    fixture = TestBed.createComponent(SpectrogramGridsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
