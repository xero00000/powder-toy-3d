// SPDX-License-Identifier: GPL-3.0-or-later

export class Soundscape {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.master = null;
    this.heatGain = null;
    this.lastCrackle = 0;
  }

  async toggle() {
    if (!this.context) this.create();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = !this.enabled;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.09 : 0, this.context.currentTime + 0.18);
    return this.enabled;
  }

  create() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    const hum = this.context.createOscillator();
    const humGain = this.context.createGain();
    const humFilter = this.context.createBiquadFilter();
    hum.type = "sine";
    hum.frequency.value = 47;
    humGain.gain.value = 0.25;
    humFilter.type = "lowpass";
    humFilter.frequency.value = 180;
    hum.connect(humFilter).connect(humGain).connect(this.master);
    hum.start();

    const heat = this.context.createOscillator();
    this.heatGain = this.context.createGain();
    heat.type = "triangle";
    heat.frequency.value = 93;
    this.heatGain.gain.value = 0;
    heat.connect(this.heatGain).connect(this.master);
    heat.start();
  }

  update(stats, activity) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    this.heatGain.gain.setTargetAtTime(Math.min(0.12, stats.hot * 0.0003), now, 0.2);
    if ((activity.explosions > 0 || activity.reactions > 5) && now - this.lastCrackle > 0.08) {
      this.lastCrackle = now;
      this.crackle(activity.explosions > 0 ? 0.52 : 0.08);
    }
  }

  crackle(intensity) {
    const length = Math.floor(this.context.sampleRate * 0.08);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = "bandpass";
    filter.frequency.value = 620 + Math.random() * 1200;
    gain.gain.value = intensity;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }
}
