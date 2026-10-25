// Electron IPC integration
let ipcRenderer = null;
try {
  if (typeof window !== 'undefined' && window.require) {
    const electron = window.require('electron');
    ipcRenderer = electron.ipcRenderer;
  }
} catch (e) {
  console.log('Running outside Electron');
}

let app = null;
let currentModel = null;
let isSpeaking = false;
let mouthAnimationId = null;
let isGhostMode = false;
let chatHistory = [];
let autoHideSpeechTimer = null;
const defaultModelPath = 'models/haru/haru_greeter_t03.model3.json';

// DOM Elements
const layout = document.getElementById('companion-layout');
const canvas = document.getElementById('live2d-canvas');
const speechBox = document.getElementById('speech-box');
const speechTag = document.getElementById('speech-tag');
const speechContent = document.getElementById('speech-content');
const btnCloseSpeech = document.getElementById('btn-close-speech');
const chatPill = document.getElementById('chat-pill');
const chatBox = document.getElementById('chat-box');
const btnDodge = document.getElementById('btn-dodge');
const miniInput = document.getElementById('mini-input');
const btnMiniSend = document.getElementById('btn-mini-send');

// Emotion configurations
const EMOTIONS = {
  goda: { label: 'Ara ara~', icon: 'fa-heart-circle-bolt', motion: 'Tap' },
  senyum_lembut: { label: 'Akeno', icon: 'fa-heart', motion: 'Idle' },
  fokus: { label: 'Fokus', icon: 'fa-magnifying-glass', motion: 'Idle' },
  senang: { label: 'Senang', icon: 'fa-face-smile-wink', motion: 'Tap' },
  khawatir: { label: 'Khawatir', icon: 'fa-hand-holding-heart', motion: 'Idle' },
  berpikir: { label: 'Berpikir...', icon: 'fa-brain', motion: 'Idle' }
};

// 1. Initialize PixiJS for Slim 250px Avatar Column
async function initPixi() {
  const width = 250;
  const height = 530;

  app = new PIXI.Application({
    view: canvas,
    width: width,
    height: height,
    transparent: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    antialias: true
  });

  PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);

  try {
    const model = await PIXI.live2d.Live2DModel.from(defaultModelPath, {
      autoInteract: true
    });

    currentModel = model;
    app.stage.addChild(model);

    // Scale and position model: Face & chest high up, thighs lower down
    const scale = (height / model.height) * 0.95;
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.x = width * 0.5;
    model.y = height * 0.50;

    console.log('Slim Live2D Model Ready!');
  } catch (err) {
    console.error('Failed to load model:', err);
  }
}

// 2. Simulated Lip-Sync
function startLipSync() {
  if (isSpeaking) return;
  isSpeaking = true;
  let time = 0;

  function animate() {
    if (!isSpeaking) {
      setMouth(0);
      return;
    }
    time += 0.28;
    const mouthVal = Math.max(0, Math.sin(time) * 0.55 + Math.sin(time * 2.2) * 0.25);
    setMouth(mouthVal);
    mouthAnimationId = requestAnimationFrame(animate);
  }
  animate();
}

function stopLipSync() {
  isSpeaking = false;
  if (mouthAnimationId) {
    cancelAnimationFrame(mouthAnimationId);
    mouthAnimationId = null;
  }
  setMouth(0);
}

function setMouth(val) {
  if (!currentModel || !currentModel.internalModel) return;
  try {
    const core = currentModel.internalModel.coreModel;
    if (core && core.setParameterValueById) {
      core.setParameterValueById('ParamMouthOpenY', val);
    }
  } catch (e) {}
}

// 3. Speech Box & Typewriter
function speak(text, emotionKey = 'senyum_lembut') {
  if (autoHideSpeechTimer) clearTimeout(autoHideSpeechTimer);

  const emo = EMOTIONS[emotionKey] || EMOTIONS.senyum_lembut;
  speechTag.innerHTML = `<i class="fa-solid ${emo.icon}"></i> ${emo.label}`;

  if (currentModel && emo.motion && currentModel.motion) {
    try { currentModel.motion(emo.motion); } catch (e) {}
  }

  speechBox.classList.remove('hidden');
  speechContent.textContent = '';
  startLipSync();

  let index = 0;
  const timer = setInterval(() => {
    if (index < text.length) {
      speechContent.textContent += text.charAt(index);
      speechContent.scrollTop = speechContent.scrollHeight;
      index++;
    } else {
      clearInterval(timer);
      stopLipSync();
      // Auto-hide after 8 seconds of idle
      autoHideSpeechTimer = setTimeout(() => {
        if (!isSpeaking) speechBox.classList.add('hidden');
      }, 8000);
    }
  }, 22);
}

// Dismiss speech response by clicking close 'x'
function hideSpeech() {
  speechBox.classList.add('hidden');
  stopLipSync();
  if (autoHideSpeechTimer) clearTimeout(autoHideSpeechTimer);
}

btnCloseSpeech.addEventListener('click', (e) => {
  e.stopPropagation();
  hideSpeech();
});

// 4. Ghost Mode Handler (From Tray)
if (ipcRenderer) {
  ipcRenderer.on('toggle-ghost-state', (event, active) => {
    isGhostMode = active;
    if (isGhostMode) {
      layout.classList.add('ghost-mode');
    } else {
      layout.classList.remove('ghost-mode');
    }
  });
}

// 5. Dodge Corner Button
btnDodge.addEventListener('click', (e) => {
  e.stopPropagation();
  if (ipcRenderer) {
    ipcRenderer.send('dodge-corner');
  }
});

// 6. Mini Chat Logic
chatPill.addEventListener('click', () => {
  chatPill.style.display = 'none';
  btnDodge.style.display = 'none';
  chatBox.classList.add('active');
  miniInput.focus();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.chat-bottom-bar') && chatBox.classList.contains('active')) {
    chatBox.classList.remove('active');
    chatPill.style.display = 'flex';
    btnDodge.style.display = 'flex';
  }
});

async function sendMiniMessage() {
  const text = miniInput.value.trim();
  if (!text) return;

  miniInput.value = '';
  chatBox.classList.remove('active');
  chatPill.style.display = 'flex';
  btnDodge.style.display = 'flex';

  speak('Ara ara... tunggu sebentar ya, aku sedang mengeksekusinya di sistemmu...', 'fokus');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: chatHistory })
    });
    const data = await res.json();
    if (res.ok) {
      chatHistory.push({ role: 'user', text });
      chatHistory.push({ role: 'assistant', text: data.reply });
      speak(data.reply, data.emotion || 'senyum_lembut');
    } else {
      speak('Ara ara... ada kendala: ' + data.error, 'khawatir');
    }
  } catch (err) {
    speak('Koneksi terputus: ' + err.message, 'khawatir');
  }
}

btnMiniSend.addEventListener('click', (e) => {
  e.stopPropagation();
  sendMiniMessage();
});

miniInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMiniMessage();
  }
});

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  initPixi();
  // Brief welcome greeting, auto-hides after 5s
  speak('Ara ara~ Selamat datang! Aku siap menemanimu bekerja di sini~', 'senyum_lembut');
});
