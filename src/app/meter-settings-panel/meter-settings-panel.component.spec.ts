import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MeterSettingsPanelComponent } from './meter-settings-panel.component';

describe('MeterSettingsPanelComponent', () => {
  let component: MeterSettingsPanelComponent;
  let fixture: ComponentFixture<MeterSettingsPanelComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [MeterSettingsPanelComponent]
    });
    fixture = TestBed.createComponent(MeterSettingsPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
