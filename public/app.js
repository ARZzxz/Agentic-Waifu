// State management
let app = null;
let currentModel = null;
let isSpeaking = false;
let mouthAnimationId = null;
let chatHistory = [];
let defaultModelPath = 'models/haru/haru_greeter_t03.model3.json';

// DOM Elements
const canvas = document.getElementById('live2d-canvas');
const canvasContainer = document.getElementById('canvas-container');
const bubbleContainer = document.getElementById('speech-bubble-container');
const bubbleText = document.getElementById('bubble-text');
const emotionBadge = document.getElementById('emotion-badge');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');
const characterStatus = document.getElementById('character-status');
const statusDot = document.getElementById('status-dot');
const apiStatusIndicator = document.getElementById('api-status-indicator');

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const btnSettings = document.getElementById('btn-settings');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const inputApiKey = document.getElementById('input-api-key');
const btnToggleKeyVisibility = document.getElementById('btn-toggle-key-visibility');
const selectModel = document.getElementById('select-model');
const selectLive2D = document.getElementById('select-live2d');

// Quick Control Elements
const btnResetPos = document.getElementById('btn-reset-pos');
const btnToggleBubble = document.getElementById('btn-toggle-bubble');

// Emotion configurations for Akeno
const EMOTIONS = {
  goda: {
    label: 'Siap Membantu',
    icon: 'fa-heart-circle-bolt',
    motionGroup: 'Tap',
    expression: 'f03'
  },
  senyum_lembut: {
    label: 'Senang',
    icon: 'fa-heart',
    motionGroup: 'Idle',
    expression: 'f01'
  },
  fokus: {
    label: 'Analisis',
    icon: 'fa-magnifying-glass',
    motionGroup: 'Idle',
    expression: 'f05'
  },
  senang: {
    label: 'Responsif',
    icon: 'fa-face-smile-wink',
    motionGroup: 'Tap',
    expression: 'f00'
  },
  khawatir: {
    label: 'Perhatian',
    icon: 'fa-hand-holding-heart',
    motionGroup: 'Idle',
    expression: 'f04'
  },
  berpikir: {
    label: 'Memproses',
    icon: 'fa-brain',
    motionGroup: 'Idle',
    expression: 'f02'
  }
};

// 1. Initialize PixiJS Application
async function initPixi() {
  const rect = canvasContainer.getBoundingClientRect();
  
  app = new PIXI.Application({
    view: canvas,
    width: rect.width || 800,
    height: rect.height || 700,
    transparent: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    antialias: true
  });

  window.addEventListener('resize', () => {
    const r = canvasContainer.getBoundingClientRect();
    app.renderer.resize(r.width, r.height);
    if (currentModel) {
      positionModel(currentModel);
    }
  });

  // Load Model
  await loadLive2DModel(defaultModelPath);
}

// 2. Load and Configure Live2D Model
async function loadLive2DModel(modelPath) {
  try {
    characterStatus.textContent = 'Memuat Model Live2D...';
    
    if (currentModel) {
      app.stage.removeChild(currentModel);
      currentModel.destroy();
      currentModel = null;
    }

    // Register PIXI ticker
    PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);

    const model = await PIXI.live2d.Live2DModel.from(modelPath, {
      autoInteract: true,
    });

    currentModel = model;
    app.stage.addChild(model);

    positionModel(model);
    setupModelInteractivity(model);

    characterStatus.textContent = 'AI Assistant • Ready';
    console.log('Model Live2D berhasil dimuat!');
  } catch (err) {
    console.error('Gagal memuat model Live2D:', err);
    characterStatus.textContent = 'Gagal memuat aset model';
    showBubble('Maaf, model avatar belum dapat dimuat dengan benar. Silakan cek console browser.', 'khawatir');
  }
}

// Position & Scale Model
function positionModel(model) {
  if (!model) return;
  const canvasWidth = app.renderer.width;
  const canvasHeight = app.renderer.height;

  // Scale model appropriately to fit viewport
  const scale = (canvasHeight / model.height) * 0.88;
  model.scale.set(scale);

  // Position at bottom center-left
  model.anchor.set(0.5, 0.5);
  model.x = canvasWidth * 0.45;
  model.y = canvasHeight * 0.55;
}

// Enable Dragging & Zooming for Model
function setupModelInteractivity(model) {
  model.interactive = true;
  model.buttonMode = true;

  let isDragging = false;
  let dragData = null;
  let startX = 0;
  let startY = 0;

  model.on('pointerdown', (e) => {
    isDragging = true;
    dragData = e.data;
    const pos = dragData.getLocalPosition(model.parent);
    startX = pos.x - model.x;
    startY = pos.y - model.y;
  });

  model.on('pointermove', () => {
    if (isDragging && dragData) {
      const pos = dragData.getLocalPosition(model.parent);
      model.x = pos.x - startX;
      model.y = pos.y - startY;
    }
  });

  const stopDrag = () => {
    isDragging = false;
    dragData = null;
  };

  model.on('pointerup', stopDrag);
  model.on('pointerupoutside', stopDrag);

  // Wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!currentModel) return;
    const factor = e.deltaY < 0 ? 1.05 : 0.95;
    const newScale = currentModel.scale.x * factor;
    if (newScale > 0.1 && newScale < 3.0) {
      currentModel.scale.set(newScale);
    }
  }, { passive: false });
}

// 3. Simulated Lip-Sync & Natural Mouth Movement
function startLipSync() {
  if (isSpeaking) return;
  isSpeaking = true;
  let time = 0;

  function animateMouth() {
    if (!isSpeaking) {
      setMouthOpen(0);
      return;
    }
    time += 0.25;
    // Oscillate mouth naturally between 0.0 and 0.75 with harmonic variations
    const mouthValue = Math.max(0, Math.sin(time) * 0.5 + Math.sin(time * 2.3) * 0.25);
    setMouthOpen(mouthValue);
    mouthAnimationId = requestAnimationFrame(animateMouth);
  }

  animateMouth();
}

function stopLipSync() {
  isSpeaking = false;
  if (mouthAnimationId) {
    cancelAnimationFrame(mouthAnimationId);
    mouthAnimationId = null;
  }
  setMouthOpen(0);
}

function setMouthOpen(val) {
  if (!currentModel || !currentModel.internalModel) return;
  try {
    const core = currentModel.internalModel.coreModel;
    if (core && core.setParameterValueById) {
      core.setParameterValueById('ParamMouthOpenY', val);
    }
  } catch (e) {
    // Ignore if parameter id doesn't match
  }
}

// 4. Emotion & Speech Bubble Handlers
function applyEmotion(emotionKey) {
  const emo = EMOTIONS[emotionKey] || EMOTIONS.senyum_lembut;
  
  // Update badge UI
  emotionBadge.innerHTML = `<i class="fa-solid ${emo.icon}"></i> ${emo.label}`;

  if (!currentModel) return;

  // Trigger Live2D expression or motion
  try {
    if (emo.expression && currentModel.expression) {
      currentModel.expression(emo.expression);
    }
    if (emo.motionGroup && currentModel.motion) {
      currentModel.motion(emo.motionGroup);
    }
  } catch (err) {
    console.warn('Gagal memicu ekspresi/motion Live2D:', err);
  }
}

function showBubble(text, emotionKey = 'senyum_lembut') {
  applyEmotion(emotionKey);
  bubbleContainer.style.opacity = '1';
  bubbleContainer.style.transform = 'translateY(0)';

  // Typewriter effect in speech bubble
  bubbleText.textContent = '';
  startLipSync();

  let index = 0;
  const speed = 25; // ms per char

  const timer = setInterval(() => {
    if (index < text.length) {
      bubbleText.textContent += text.charAt(index);
      index++;
    } else {
      clearInterval(timer);
      stopLipSync();
    }
  }, speed);
}

// 5. Chat Interaction Logic
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Append user message
  appendMessage('user', text);
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // Update status UI
  btnSend.disabled = true;
  characterStatus.textContent = 'AI Assistant sedang memproses...';
  statusDot.style.background = '#f59e0b'; // amber
  applyEmotion('berpikir');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: chatHistory
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Gagal berkomunikasi dengan server.');
    }

    const reply = data.reply;
    const emotion = data.emotion || 'senyum_lembut';

    // Save to history
    chatHistory.push({ role: 'user', text: text });
    chatHistory.push({ role: 'assistant', text: reply });

    // Show response in bubble and chat log
    appendMessage('assistant', reply);
    showBubble(reply, emotion);

    characterStatus.textContent = 'AI Assistant • Ready';
    statusDot.style.background = '#10b981'; // green
  } catch (err) {
    console.error('Chat error:', err);
    appendMessage('assistant', `Terjadi kendala saat memproses permintaan: ${err.message}`);
    showBubble(`Terjadi kendala saat memproses permintaan: ${err.message}`, 'khawatir');
    characterStatus.textContent = 'Koneksi bermasalah';
    statusDot.style.background = '#ef4444'; // red
  } finally {
    btnSend.disabled = false;
  }
}

function appendMessage(role, text) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const p = document.createElement('p');
  p.textContent = text;

  const time = document.createElement('span');
  time.className = 'message-time';
  const now = new Date();
  time.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  bubble.appendChild(p);
  bubble.appendChild(time);
  row.appendChild(bubble);

  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 6. Check Server & API Configuration Status
async function checkApiStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.configured) {
      apiStatusIndicator.textContent = `Online • ${data.model}`;
      apiStatusIndicator.className = 'api-status ok';
    } else {
      apiStatusIndicator.textContent = 'API Key belum disetel!';
      apiStatusIndicator.className = 'api-status warning';
    }
  } catch (err) {
    apiStatusIndicator.textContent = 'Server Offline';
    apiStatusIndicator.className = 'api-status warning';
  }
}

// 7. Event Listeners & Setup
function setupEventListeners() {
  // Chat send triggers
  btnSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  });

  // Quick prompt pills
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chatInput.value = btn.dataset.prompt;
      sendMessage();
    });
  });

  // Reset model position
  btnResetPos.addEventListener('click', () => {
    if (currentModel) positionModel(currentModel);
  });

  // Toggle speech bubble
  btnToggleBubble.addEventListener('click', () => {
    const isHidden = bubbleContainer.style.display === 'none';
    bubbleContainer.style.display = isHidden ? 'block' : 'none';
  });

  // Settings modal
  btnSettings.addEventListener('click', () => {
    settingsModal.classList.add('active');
  });

  const closeModal = () => settingsModal.classList.remove('active');
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelSettings.addEventListener('click', closeModal);

  // Toggle API key visibility
  btnToggleKeyVisibility.addEventListener('click', () => {
    const isPassword = inputApiKey.type === 'password';
    inputApiKey.type = isPassword ? 'text' : 'password';
    btnToggleKeyVisibility.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  });

  // Save Settings
  btnSaveSettings.addEventListener('click', async () => {
    const key = inputApiKey.value.trim();
    const model = selectModel.value;

    if (!key) {
      alert('Silakan masukkan API Key.');
      return;
    }

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key, model: model })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Pengaturan berhasil disimpan!');
        closeModal();
        inputApiKey.value = '';
        checkApiStatus();
      } else {
        alert('Gagal: ' + data.error);
      }
    } catch (err) {
      alert('Gagal menyimpan pengaturan: ' + err.message);
    }
  });
}

// Bootstrap Application
window.addEventListener('DOMContentLoaded', () => {
  initPixi();
  setupEventListeners();
  checkApiStatus();
});
