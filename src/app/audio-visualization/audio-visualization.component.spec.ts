import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioVisualizationComponent } from './audio-visualization.component';

describe('AudioVisualizationComponent', () => {
  let component: AudioVisualizationComponent;
  let fixture: ComponentFixture<AudioVisualizationComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [AudioVisualizationComponent]
    });
    fixture = TestBed.createComponent(AudioVisualizationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
