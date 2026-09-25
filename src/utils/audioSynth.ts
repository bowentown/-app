/**
 * Real Web Audio API synthesizer for sleep sounds
 * Supports Rain, Ocean Surf, Night Forest/Crickets, Deep Pink Noise, and Tibetan Singing Bowl
 */

class SleepAudioSynthesizer {
  private ctx: AudioContext | null = null;
  private isPlaying: boolean = false;
  private currentType: string | null = null;
  private masterGain: GainNode | null = null;
  private activeNodes: (AudioNode | number)[] = [];
  private volume: number = 0.5;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setVolume(val: number) {
    // Hearing health safety limit (WHO long-term sleep exposure cap: < 70 dBA equivalent)
    const SAFE_MAX_VOLUME = 0.72;
    this.volume = Math.max(0, Math.min(SAFE_MAX_VOLUME, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentType(): string | null {
    return this.currentType;
  }

  public stop() {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.1);
      setTimeout(() => {
        this.cleanupNodes();
        this.isPlaying = false;
        this.currentType = null;
      }, 150);
    } else {
      this.cleanupNodes();
      this.isPlaying = false;
      this.currentType = null;
    }
  }

  private cleanupNodes() {
    for (const item of this.activeNodes) {
      if (typeof item === 'number') {
        window.clearInterval(item);
      } else {
        try {
          if ('stop' in item && typeof (item as any).stop === 'function') {
            (item as any).stop();
          }
          item.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }
    }
    this.activeNodes = [];
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // ignore
      }
      this.masterGain = null;
    }
  }

  public play(type: 'rain' | 'ocean' | 'forest' | 'whitenoise' | 'bowl') {
    this.initContext();
    if (!this.ctx) return;

    if (this.isPlaying && this.currentType === type) {
      this.stop();
      return;
    }

    this.stop();

    // Create master gain
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.001, this.ctx.currentTime);
    master.gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + 0.3);
    master.connect(this.ctx.destination);
    this.masterGain = master;

    this.isPlaying = true;
    this.currentType = type;

    switch (type) {
      case 'rain':
        this.startRain(master);
        break;
      case 'ocean':
        this.startOcean(master);
        break;
      case 'forest':
        this.startForest(master);
        break;
      case 'whitenoise':
        this.startPinkNoise(master);
        break;
      case 'bowl':
        this.startTibetanBowl(master);
        break;
    }
  }

  // Ringing alarm tone for custom wakeup alarms
  public playAlarm(tone: 'gentle_chime' | 'aurora_melody' | 'radar_beep' = 'gentle_chime') {
    this.initContext();
    if (!this.ctx) return;
    this.stop();

    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.001, this.ctx.currentTime);
    master.gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + 0.2);
    master.connect(this.ctx.destination);
    this.masterGain = master;
    this.isPlaying = true;
    this.currentType = 'alarm';

    if (tone === 'gentle_chime') {
      // Harmonic singing chime every 2.8s (528Hz Solfeggio series)
      const playChimeNote = () => {
        if (!this.ctx || !this.isPlaying) return;
        const notes = [528, 660, 792, 1056];
        notes.forEach((freq, i) => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const noteGain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const noteTime = this.ctx.currentTime + i * 0.22;
          noteGain.gain.setValueAtTime(0.001, noteTime);
          noteGain.gain.linearRampToValueAtTime(0.18 / (i + 1), noteTime + 0.05);
          noteGain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 1.8);
          osc.connect(noteGain);
          noteGain.connect(master);
          osc.start(noteTime);
          osc.stop(noteTime + 2.0);
        });
      };
      playChimeNote();
      const interval = window.setInterval(playChimeNote, 2800);
      this.activeNodes.push(interval);
    } else if (tone === 'aurora_melody') {
      // Calming ascending pentatonic melody
      const notes = [392, 440, 523.25, 587.33, 659.25, 783.99];
      let step = 0;
      const playStep = () => {
        if (!this.ctx || !this.isPlaying) return;
        const freq = notes[step % notes.length];
        step++;
        const osc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const noteTime = this.ctx.currentTime;
        noteGain.gain.setValueAtTime(0.001, noteTime);
        noteGain.gain.linearRampToValueAtTime(0.15, noteTime + 0.04);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.9);
        osc.connect(noteGain);
        noteGain.connect(master);
        osc.start(noteTime);
        osc.stop(noteTime + 1.0);
      };
      playStep();
      const interval = window.setInterval(playStep, 600);
      this.activeNodes.push(interval);
    } else {
      // Classic rhythmic soft alert
      const playBeep = () => {
        if (!this.ctx || !this.isPlaying) return;
        const osc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        const now = this.ctx.currentTime;
        noteGain.gain.setValueAtTime(0.15, now);
        noteGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(noteGain);
        noteGain.connect(master);
        osc.start(now);
        osc.stop(now + 0.25);
      };
      playBeep();
      const interval = window.setInterval(playBeep, 1000);
      this.activeNodes.push(interval);
    }
  }

  // 1. Rain Sound Synthesis
  private startRain(dest: AudioNode) {
    if (!this.ctx) return;
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // Filter to sound like soft rainfall against window
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;

    const highpass = this.ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 250;

    whiteNoise.connect(highpass);
    highpass.connect(filter);
    filter.connect(dest);
    whiteNoise.start();

    this.activeNodes.push(whiteNoise, filter, highpass);

    // Random raindrops
    const dropInterval = window.setInterval(() => {
      if (!this.ctx || !this.isPlaying) return;
      const osc = this.ctx.createOscillator();
      const dropGain = this.ctx.createGain();
      const freq = 1200 + Math.random() * 1800;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, this.ctx.currentTime + 0.05);

      dropGain.gain.setValueAtTime(0.04 * (0.5 + Math.random() * 0.5), this.ctx.currentTime);
      dropGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.06);

      osc.connect(dropGain);
      dropGain.connect(dest);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.07);
    }, 180);

    this.activeNodes.push(dropInterval);
  }

  // 2. Ocean Waves Synthesis
  private startOcean(dest: AudioNode) {
    if (!this.ctx) return;
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11;
      b6 = white * 0.115926;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    // LFO for surf wave surging rhythm (approx 0.12 Hz = 8 seconds per wave)
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.12;

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 350;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const waveGain = this.ctx.createGain();
    const lfoAmp = this.ctx.createOscillator();
    lfoAmp.frequency.value = 0.12;
    const lfoAmpGain = this.ctx.createGain();
    lfoAmpGain.gain.value = 0.35;
    waveGain.gain.value = 0.6;
    lfoAmp.connect(lfoAmpGain);
    lfoAmpGain.connect(waveGain.gain);

    noise.connect(filter);
    filter.connect(waveGain);
    waveGain.connect(dest);

    noise.start();
    lfo.start();
    lfoAmp.start();

    this.activeNodes.push(noise, filter, lfo, lfoGain, waveGain, lfoAmp, lfoAmpGain);
  }

  // 3. Night Forest & Subtle Crickets
  private startForest(dest: AudioNode) {
    if (!this.ctx) return;

    // Gentle night wind floor
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.04;
    }
    const wind = this.ctx.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 350;
    windFilter.Q.value = 1.2;

    wind.connect(windFilter);
    windFilter.connect(dest);
    wind.start();
    this.activeNodes.push(wind, windFilter);

    // Cricket chirps generator
    const chirpTimer = window.setInterval(() => {
      if (!this.ctx || !this.isPlaying) return;
      if (Math.random() > 0.65) return;

      const osc = this.ctx.createOscillator();
      const chirpGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4500 + Math.random() * 400, this.ctx.currentTime);

      chirpGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      chirpGain.gain.linearRampToValueAtTime(0.015, this.ctx.currentTime + 0.03);
      chirpGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);

      osc.connect(chirpGain);
      chirpGain.connect(dest);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.09);
    }, 320);

    this.activeNodes.push(chirpTimer);
  }

  // 4. Pink / Deep White Noise
  private startPinkNoise(dest: AudioNode) {
    if (!this.ctx) return;
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.15;
      b6 = white * 0.115926;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;

    noise.connect(filter);
    filter.connect(dest);
    noise.start();

    this.activeNodes.push(noise, filter);
  }

  // 5. Tibetan Singing Bowl / Binaural Alpha Waves
  private startTibetanBowl(dest: AudioNode) {
    if (!this.ctx) return;

    // Resonant fundamental + harmonics
    const freqs = [216, 432, 648]; // warm harmonic series
    freqs.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq + (idx === 1 ? 4 : 0); // 4Hz theta wave beating

      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoG = this.ctx.createGain();
      lfoG.gain.value = 0.05 / (idx + 1);

      lfo.connect(lfoG);
      lfoG.connect(gain.gain);

      gain.gain.value = 0.12 / (idx + 1);

      osc.connect(gain);
      gain.connect(dest);

      osc.start();
      lfo.start();
      this.activeNodes.push(osc, gain, lfo, lfoG);
    });
  }
}

export const sleepAudio = new SleepAudioSynthesizer();
