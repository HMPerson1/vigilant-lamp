import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AudioWaveformComponent } from './audio-waveform.component';

describe('AudioWaveformComponent', () => {
  let component: AudioWaveformComponent;
  let fixture: ComponentFixture<AudioWaveformComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AudioWaveformComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AudioWaveformComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
