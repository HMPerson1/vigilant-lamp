import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AudioContextService {
  public readonly audioContext = new AudioContext()
}
