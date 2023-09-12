import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PartDialogComponent } from './part-dialog.component';

describe('PartDialogComponent', () => {
  let component: PartDialogComponent;
  let fixture: ComponentFixture<PartDialogComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PartDialogComponent]
    });
    fixture = TestBed.createComponent(PartDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
