import { SoundTouchNode } from '@soundtouchjs/audio-worklet';

type SourceMode = 'buffer' | 'element';

function formatTime(secs: number): string {
  const mins = Math.floor(secs / 60);
  const seconds = Math.floor(secs - mins * 60);
  return `${mins}:${String(seconds).padStart(2, '0')}`;
}

// --- DOM refs ---
const modeBufferBtn = document.getElementById(
  'modeBuffer',
) as HTMLButtonElement;
const modeElementBtn = document.getElementById(
  'modeElement',
) as HTMLButtonElement;
const bufferControls = document.getElementById(
  'bufferControls',
) as HTMLDivElement;
const elementControls = document.getElementById(
  'elementControls',
) as HTMLDivElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const tempoSlider = document.getElementById('tempoSlider') as HTMLInputElement;
const tempoInput = document.getElementById('tempoInput') as HTMLInputElement;
const pitchSlider = document.getElementById('pitchSlider') as HTMLInputElement;
const pitchInput = document.getElementById('pitchInput') as HTMLInputElement;
const keySlider = document.getElementById('keySlider') as HTMLInputElement;
const keyInput = document.getElementById('keyInput') as HTMLInputElement;
const volumeSlider = document.getElementById(
  'volumeSlider',
) as HTMLInputElement;
const volumeInput = document.getElementById('volumeInput') as HTMLInputElement;
const currTime = document.getElementById('currentTime') as HTMLSpanElement;
const duration = document.getElementById('duration') as HTMLSpanElement;
const progressMeter = document.getElementById(
  'progressMeter',
) as HTMLProgressElement;
const audioEl = document.getElementById('audioEl') as HTMLAudioElement;
const audioFileInput = document.getElementById('audioFile') as HTMLInputElement;
const sourceName = document.getElementById('sourceName') as HTMLSpanElement;
const codeBlock = document.getElementById('codeBlock') as HTMLDivElement;

// --- State ---
let audioCtx: AudioContext;
let gainNode: GainNode;
let stNode: SoundTouchNode;
let sourceNode: AudioBufferSourceNode | undefined;
let elementSourceNode: MediaElementAudioSourceNode | undefined;
let audioBuffer: AudioBuffer | undefined;
let isPlaying = false;
let playStartTime = 0;
let pauseOffset = 0;
let rafId = 0;
let currentTempo = 1;
let currentPitch = 1;
let currentKey = 0;
let currentVolume = 1;
let activeMode: SourceMode = 'buffer';
let currentObjectUrl: string | undefined;

const DEFAULT_SOURCE_URL = './bensound-actionable.mp3';
const DEFAULT_SOURCE_NAME = 'bensound-actionable.mp3';

function formatControlValue(value: number, digits: number): string {
  return digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
}

function bindNumericControl(options: {
  range: HTMLInputElement;
  input: HTMLInputElement;
  digits: number;
  apply: (value: number) => void;
}): (value: number) => void {
  const { range, input, digits, apply } = options;
  const min = Number(range.min);
  const max = Number(range.max);

  const setValue = (rawValue: number): void => {
    if (!Number.isFinite(rawValue)) {
      input.value = formatControlValue(Number(range.value), digits);
      return;
    }

    let value = Math.min(max, Math.max(min, rawValue));
    value = digits === 0 ? Math.round(value) : Number(value.toFixed(digits));

    range.value = String(value);
    input.value = formatControlValue(value, digits);
    apply(value);
  };

  range.addEventListener('input', () => setValue(Number(range.value)));
  input.addEventListener('change', () => setValue(Number(input.value)));
  setValue(Number(range.value));

  return setValue;
}

// --- Code snippets ---
const BUFFER_CODE = `import { SoundTouchNode } from '@soundtouchjs/audio-worklet';

const audioCtx = new AudioContext();
const gainNode = audioCtx.createGain();
gainNode.connect(audioCtx.destination);

await SoundTouchNode.register(audioCtx, '/soundtouch-processor.js');
const stNode = new SoundTouchNode(audioCtx);
stNode.connect(gainNode);

const response = await fetch('/audio.mp3');
const buffer = await response.arrayBuffer();
const audioBuffer = await audioCtx.decodeAudioData(buffer);

const source = audioCtx.createBufferSource();
source.buffer = audioBuffer;
source.playbackRate.value = tempo;    // tempo via playback rate
source.connect(stNode);

stNode.playbackRate.value = tempo;    // tell processor the source rate
stNode.pitch.value = pitch;           // desired pitch (auto-compensated)
stNode.pitchSemitones.value = key;
gainNode.gain.value = volume;

source.start();`;

const ELEMENT_CODE = `import { SoundTouchNode } from '@soundtouchjs/audio-worklet';

const audioEl = document.querySelector('audio')!;
const audioCtx = new AudioContext();
const gainNode = audioCtx.createGain();
gainNode.connect(audioCtx.destination);

await SoundTouchNode.register(audioCtx, '/soundtouch-processor.js');
const stNode = new SoundTouchNode(audioCtx);
stNode.connect(gainNode);

const source = audioCtx.createMediaElementSource(audioEl);
source.connect(stNode);

audioEl.preservesPitch = false;       // let SoundTouch handle pitch
audioEl.playbackRate = tempo;         // tempo via element playback rate
stNode.playbackRate.value = tempo;    // tell processor the source rate
stNode.pitch.value = pitch;           // desired pitch (auto-compensated)
stNode.pitchSemitones.value = key;
gainNode.gain.value = volume;`;

// --- Init ---
async function init(): Promise<void> {
  audioCtx = new AudioContext();
  gainNode = audioCtx.createGain();
  await SoundTouchNode.register(audioCtx, '/soundtouch-processor.js');
  stNode = new SoundTouchNode(audioCtx);
  stNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
}

const ready = init();

function resetPlaybackState(): void {
  if (sourceNode) {
    sourceNode.onended = null;
    sourceNode.stop();
    sourceNode.disconnect();
    sourceNode = undefined;
  }
  audioEl.pause();
  audioEl.currentTime = 0;
  cancelAnimationFrame(rafId);
  isPlaying = false;
  pauseOffset = 0;
  playStartTime = 0;
  progressMeter.value = 0;
  currTime.innerHTML = formatTime(0);
  playBtn.removeAttribute('disabled');
}

function updateSourceName(name: string): void {
  sourceName.textContent = name;
}

function revokeCurrentObjectUrl(): void {
  if (!currentObjectUrl) return;
  URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = undefined;
}

async function loadAudioSource(
  source: { buffer: ArrayBuffer; src: string; name: string },
  objectUrl?: string,
): Promise<void> {
  playBtn.setAttribute('disabled', 'disabled');
  await ready;
  resetPlaybackState();
  revokeCurrentObjectUrl();
  currentObjectUrl = objectUrl;
  audioEl.src = source.src;
  audioEl.load();
  audioBuffer = await audioCtx.decodeAudioData(source.buffer);
  pauseOffset = 0;
  duration.innerHTML = formatTime(audioBuffer.duration);
  updateSourceName(source.name);
  playBtn.removeAttribute('disabled');
}

async function loadAudioBuffer(url: string, name: string): Promise<void> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  await loadAudioSource({ buffer, src: url, name });
}

async function loadAudioFile(file: File): Promise<void> {
  const buffer = await file.arrayBuffer();
  const objectUrl = URL.createObjectURL(file);
  await loadAudioSource({ buffer, src: objectUrl, name: file.name }, objectUrl);
}

function connectAudioElement(): void {
  if (elementSourceNode) return;
  elementSourceNode = audioCtx.createMediaElementSource(audioEl);
  elementSourceNode.connect(stNode);
}

// --- Buffer mode: play/pause/progress ---
function updateProgress(): void {
  if (!audioBuffer || !isPlaying) return;
  const wallElapsed = audioCtx.currentTime - playStartTime;
  const sourceElapsed = pauseOffset + wallElapsed * currentTempo;
  const perc = Math.min(sourceElapsed / audioBuffer.duration, 1);
  currTime.innerHTML = formatTime(sourceElapsed);
  progressMeter.value = perc * 100;
  if (perc >= 1) {
    bufferPause();
    return;
  }
  rafId = requestAnimationFrame(updateProgress);
}

function bufferPlay(): void {
  if (!audioBuffer) return;
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.playbackRate.value = currentTempo;
  sourceNode.connect(stNode);
  stNode.playbackRate.value = currentTempo;

  playStartTime = audioCtx.currentTime;
  sourceNode.start(0, pauseOffset);
  sourceNode.onended = () => {
    if (isPlaying) bufferPause();
  };

  audioCtx.resume().then(() => {
    isPlaying = true;
    playBtn.setAttribute('disabled', 'disabled');
    rafId = requestAnimationFrame(updateProgress);
  });
}

function bufferPause(resume = false): void {
  if (sourceNode) {
    sourceNode.onended = null;
    sourceNode.stop();
    sourceNode.disconnect();
    sourceNode = undefined;
  }
  if (isPlaying) {
    pauseOffset += (audioCtx.currentTime - playStartTime) * currentTempo;
  }
  cancelAnimationFrame(rafId);
  isPlaying = resume;
  playBtn.removeAttribute('disabled');
}

// --- Element mode ---
function elementPlay(): void {
  audioCtx.resume();
  connectAudioElement();
  audioEl.preservesPitch = false;
  audioEl.playbackRate = currentTempo;
  stNode.playbackRate.value = currentTempo;
  audioEl.play();
}

const setTempo = bindNumericControl({
  range: tempoSlider,
  input: tempoInput,
  digits: 2,
  apply: (newTempo) => {
    if (activeMode === 'buffer') {
      if (isPlaying) {
        pauseOffset += (audioCtx.currentTime - playStartTime) * currentTempo;
        playStartTime = audioCtx.currentTime;
      }
      if (sourceNode) sourceNode.playbackRate.value = newTempo;
    } else {
      audioEl.preservesPitch = false;
      audioEl.playbackRate = newTempo;
    }

    currentTempo = newTempo;
    if (stNode) {
      stNode.playbackRate.value = currentTempo;
      stNode.pitch.value = currentPitch;
    }
  },
});

const setPitch = bindNumericControl({
  range: pitchSlider,
  input: pitchInput,
  digits: 2,
  apply: (value) => {
    currentPitch = value;
    if (stNode) {
      stNode.pitch.value = currentPitch;
    }
  },
});

const setKey = bindNumericControl({
  range: keySlider,
  input: keyInput,
  digits: 0,
  apply: (value) => {
    currentKey = value;
    if (stNode) {
      stNode.pitchSemitones.value = currentKey;
    }
  },
});

const setVolume = bindNumericControl({
  range: volumeSlider,
  input: volumeInput,
  digits: 2,
  apply: (value) => {
    currentVolume = value;
    if (gainNode) {
      gainNode.gain.value = currentVolume;
    }
  },
});

// --- Mode switching ---
function setMode(mode: SourceMode): void {
  if (isPlaying) {
    if (activeMode === 'buffer') bufferPause();
    else audioEl.pause();
  }
  pauseOffset = 0;
  isPlaying = false;
  activeMode = mode;

  modeBufferBtn.classList.toggle('active', mode === 'buffer');
  modeElementBtn.classList.toggle('active', mode === 'element');
  bufferControls.style.display = mode === 'buffer' ? '' : 'none';
  elementControls.style.display = mode === 'element' ? '' : 'none';
  codeBlock.textContent = mode === 'buffer' ? BUFFER_CODE : ELEMENT_CODE;

  currentTempo = 1;
  currentPitch = 1;
  currentKey = 0;
  currentVolume = 1;
  setTempo(1);
  setPitch(1);
  setKey(0);
  setVolume(1);
}

modeBufferBtn.onclick = () => setMode('buffer');
modeElementBtn.onclick = () => setMode('element');

// --- Load and set initial mode ---
loadAudioBuffer(DEFAULT_SOURCE_URL, DEFAULT_SOURCE_NAME);
setMode('buffer');

playBtn.onclick = bufferPlay;
stopBtn.onclick = () => bufferPause();
audioFileInput.addEventListener('change', async () => {
  const [file] = audioFileInput.files ?? [];
  if (!file) return;
  await loadAudioFile(file);
});

progressMeter.addEventListener('click', (event: MouseEvent) => {
  if (activeMode !== 'buffer' || !audioBuffer) return;
  const target = event.target as HTMLProgressElement;
  const pos = target.getBoundingClientRect();
  const relX = event.pageX - pos.x;
  const perc = relX / target.offsetWidth;
  const wasPlaying = isPlaying;
  bufferPause();
  pauseOffset = perc * audioBuffer.duration;
  progressMeter.value = 100 * perc;
  currTime.innerHTML = formatTime(pauseOffset);
  if (wasPlaying) {
    bufferPlay();
  }
});

audioEl.addEventListener('play', () => {
  if (activeMode === 'element') {
    elementPlay();
  }
});
