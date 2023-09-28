import { TestBed } from '@angular/core/testing';

import { KeyboardStateService } from './keyboard-state.service';

describe('KeyboardStateService', () => {
  let service: KeyboardStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KeyboardStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
