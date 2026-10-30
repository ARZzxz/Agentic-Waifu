// State management
let app = null;
let currentModel = null;
let isSpeaking = false;
let mouthAnimationId = null;
let chatHistory = [];
let defaultModelPath = 'models/haru/haru_greeter_t03.model3.json';
let availableAvatars = [];
let activeEngine = 'live2d'; // 'live2d' | 'vrm'
let bubbleTypewriterTimer = null;

// VRM Engine State
let vrmScene = null;
let vrmCamera = null;
let vrmRenderer = null;
let currentVrm = null;
let vrmClock = null;
let vrmLoopId = null;
let vrmBlinkTimer = null;
let vrmCanvas = null;

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
    defaultModelPath = modelPath;
    app.stage.addChild(model);

    positionModel(model);
    setupModelInteractivity(model);

    characterStatus.textContent = 'AI Assistant • Ready';
    console.log('Model Live2D berhasil dimuat:', modelPath);
  } catch (err) {
    console.error('Gagal memuat model Live2D:', err);
    characterStatus.textContent = 'Gagal memuat aset model';
    showBubble('Maaf, model avatar belum dapat dimuat dengan benar. Silakan cek console browser.', 'khawatir');
  }
}

// 2B. VRM 3D Avatar Engine & Controls
function initVrmEngine() {
  if (vrmRenderer) return;
  vrmCanvas = document.getElementById('vrm-canvas');
  if (!vrmCanvas) return;
  const rect = canvasContainer.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 700;

  vrmScene = new THREE.Scene();
  vrmClock = new THREE.Clock();

  vrmCamera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
  vrmCamera.position.set(0, 1.10, 2.3);
  vrmCamera.lookAt(0, 0.95, 0);

  vrmRenderer = new THREE.WebGLRenderer({
    canvas: vrmCanvas,
    alpha: true,
    antialias: true
  });
  vrmRenderer.setSize(width, height);
  vrmRenderer.setPixelRatio(window.devicePixelRatio || 1);
  vrmRenderer.outputEncoding = THREE.sRGBEncoding;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  vrmScene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffeedd, 0.95);
  dirLight.position.set(1, 2, 1).normalize();
  vrmScene.add(dirLight);

  const backLight = new THREE.DirectionalLight(0xcceeff, 0.45);
  backLight.position.set(-1, 1, -1).normalize();
  vrmScene.add(backLight);

  window.addEventListener('resize', onVrmResize);
}

function onVrmResize() {
  if (!vrmRenderer || !vrmCamera) return;
  const rect = canvasContainer.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 700;
  vrmCamera.aspect = width / height;
  vrmCamera.updateProjectionMatrix();
  vrmRenderer.setSize(width, height);
}

function startVrmLoop() {
  if (vrmLoopId) cancelAnimationFrame(vrmLoopId);
  function loop() {
    vrmLoopId = requestAnimationFrame(loop);
    const delta = vrmClock ? vrmClock.getDelta() : 0.016;
    const time = vrmClock ? vrmClock.getElapsedTime() : Date.now() * 0.001;

    if (currentVrm) {
      if (currentVrm.humanoid) {
        try {
          const chest = currentVrm.humanoid.getNormalizedBoneNode('chest') || currentVrm.humanoid.getNormalizedBoneNode('spine');
          if (chest) {
            chest.rotation.x = Math.sin(time * 1.5) * 0.02;
          }
          const leftUpperArm = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
          const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
          if (leftUpperArm) {
            leftUpperArm.rotation.z = -1.22 + Math.sin(time * 1.5) * 0.01;
            leftUpperArm.rotation.x = 0.12;
          }
          if (rightUpperArm) {
            rightUpperArm.rotation.z = 1.22 - Math.sin(time * 1.5) * 0.01;
            rightUpperArm.rotation.x = 0.12;
          }
        } catch(e) {}
      }
      currentVrm.update(delta);
    }
    if (vrmRenderer && vrmScene && vrmCamera) {
      vrmRenderer.render(vrmScene, vrmCamera);
    }
  }
  loop();
}

function startVrmBlinking() {
  if (vrmBlinkTimer) clearInterval(vrmBlinkTimer);
  vrmBlinkTimer = setInterval(() => {
    if (!currentVrm || !currentVrm.expressionManager || isSpeaking) return;
    try {
      let blinkVal = 0;
      let closing = true;
      const bInterval = setInterval(() => {
        if (closing) {
          blinkVal += 0.25;
          if (blinkVal >= 1.0) {
            blinkVal = 1.0;
            closing = false;
          }
        } else {
          blinkVal -= 0.25;
          if (blinkVal <= 0) {
            blinkVal = 0;
            clearInterval(bInterval);
          }
        }
        currentVrm.expressionManager.setValue('blink', blinkVal);
      }, 20);
    } catch (e) {}
  }, 4000);
}

async function loadVrmModel(url) {
  initVrmEngine();
  characterStatus.textContent = 'Memuat Model 3D VRM...';

  const loader = new THREE.GLTFLoader();
  loader.register((parser) => new THREE_VRM.VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        if (!vrm) {
          characterStatus.textContent = 'Gagal: Format VRM tidak valid';
          return reject(new Error('No VRM found in model file'));
        }

        if (currentVrm) {
          vrmScene.remove(currentVrm.scene);
          THREE_VRM.VRMUtils.deepDispose(currentVrm.scene);
          currentVrm = null;
        }

        currentVrm = vrm;
        vrmScene.add(vrm.scene);

        // Face camera (+Z)
        vrm.scene.rotation.y = 0;

        // Relax arms naturally along body from T-pose
        if (vrm.humanoid) {
          try {
            const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
            if (leftUpperArm) {
              leftUpperArm.rotation.z = -1.22;
              leftUpperArm.rotation.x = 0.12;
            }
            if (rightUpperArm) {
              rightUpperArm.rotation.z = 1.22;
              rightUpperArm.rotation.x = 0.12;
            }
          } catch(e) {}
        }

        startVrmLoop();
        startVrmBlinking();
        characterStatus.textContent = 'AI Assistant • Ready (3D VRM)';
        console.log('VRM Model Loaded successfully in browser:', url);
        resolve(vrm);
      },
      undefined,
      (err) => {
        console.error('Failed to load VRM model in browser:', err);
        characterStatus.textContent = 'Gagal memuat model VRM';
        reject(err);
      }
    );
  });
}

// 2C. Switch Visual Avatar (Live2D vs 3D VRM)
async function switchAvatar(target) {
  if (!target) return;
  if (availableAvatars.length === 0) {
    await loadAvatarsList();
  }
  const q = String(target).toLowerCase().trim();
  const av = availableAvatars.find(a =>
    a.path === target ||
    a.id === q ||
    a.name.toLowerCase().includes(q) ||
    (a.id && a.id.includes(q))
  );

  if (!av) return;

  if (av.type === 'vroid_project') {
    showBubble(`Ara ara~ Model <strong>${av.name}</strong> masih berupa project mentah VRoid Studio (.vroid / data.bin).<br><br>Buka di VRoid Studio lalu pilih menu <strong>"Export as VRM"</strong> dan letakkan file <code>.vrm</code> hasil ekspornya agar bisa langsung saya tampilkan ya sayang! ✨`, 'senyum_lembut');
    return;
  }

  localStorage.setItem('preferred_avatar_path', av.path);
  if (selectLive2D) selectLive2D.value = av.path;

  if (av.type === 'live2d') {
    activeEngine = 'live2d';
    if (vrmCanvas) vrmCanvas.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
    await loadLive2DModel(av.path);
    showBubble(`Model avatar beralih ke <strong>${av.name}</strong> (Live2D)!`, 'senyum_lembut');
  } else if (av.type === 'vrm') {
    activeEngine = 'vrm';
    if (canvas) canvas.style.display = 'none';
    if (vrmCanvas) vrmCanvas.style.display = 'block';
    await loadVrmModel(av.path);
    showBubble(`Model avatar beralih ke <strong>${av.name}</strong> (3D VRM)!`, 'senyum_lembut');
  }
}

// 2D. Load Dynamic Avatars from Backend
async function loadAvatarsList() {
  try {
    const res = await fetch('/api/avatars');
    if (!res.ok) return;
    const avatars = await res.json();
    availableAvatars = avatars;

    if (selectLive2D) {
      selectLive2D.innerHTML = '';
      avatars.forEach(av => {
        const opt = document.createElement('option');
        opt.value = av.path;
        opt.dataset.id = av.id;
        opt.dataset.type = av.type;
        opt.textContent = `${av.name} (${av.type.toUpperCase()})`;
        selectLive2D.appendChild(opt);
      });

      const saved = localStorage.getItem('preferred_avatar_path');
      if (saved && avatars.some(a => a.path === saved)) {
        selectLive2D.value = saved;
      }
    }
  } catch(e) {
    console.error('Gagal memuat daftar avatar di browser:', e);
  }
}

// Position & Scale Model properly based on proportions
function positionModel(model) {
  if (!model) return;
  const canvasWidth = app.renderer.width;
  const canvasHeight = app.renderer.height;

  const baseW = model.internalModel ? model.internalModel.width : model.width;
  const baseH = model.internalModel ? model.internalModel.height : model.height;
  const isHalfBody = (baseH / baseW) < 1.4;

  let scale;
  if (isHalfBody) {
    // Half-body / desk models (e.g. Shizuku): scale proportionally so character does not overwhelm the viewport
    scale = Math.min((canvasWidth * 0.35) / baseW, (canvasHeight * 0.50) / baseH);
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.x = canvasWidth * 0.38;
    model.y = canvasHeight * 0.64;
  } else {
    // Full-body models (e.g. Haru, Tingyun)
    scale = (canvasHeight / baseH) * 0.88;
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.x = canvasWidth * 0.45;
    model.y = canvasHeight * 0.55;
  }
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
  if (activeEngine === 'live2d') {
    if (!currentModel || !currentModel.internalModel) return;
    try {
      const core = currentModel.internalModel.coreModel;
      if (core && core.setParameterValueById) {
        core.setParameterValueById('ParamMouthOpenY', val);
      }
    } catch (e) {
      // Ignore if parameter id doesn't match
    }
  } else if (activeEngine === 'vrm') {
    if (currentVrm && currentVrm.expressionManager) {
      try {
        currentVrm.expressionManager.setValue('aa', val);
      } catch (e) {}
    }
  }
}

// 4. Emotion & Speech Bubble Handlers
function applyEmotion(emotionKey) {
  const emo = EMOTIONS[emotionKey] || EMOTIONS.senyum_lembut;
  
  // Update badge UI
  emotionBadge.innerHTML = `<i class="fa-solid ${emo.icon}"></i> ${emo.label}`;

  if (activeEngine === 'live2d' && currentModel) {
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
  } else if (activeEngine === 'vrm' && currentVrm && currentVrm.expressionManager) {
    const vrmMap = {
      senang: 'happy',
      antusias: 'happy',
      bangga: 'happy',
      lucu: 'happy',
      sedih: 'sad',
      kecewa: 'sad',
      marah: 'angry',
      terkejut: 'surprised',
      bingung: 'neutral',
      santai: 'relaxed',
      senyum_lembut: 'relaxed',
      fokus: 'relaxed',
      berpikir: 'neutral',
      khawatir: 'sad'
    };
    const preset = vrmMap[emotionKey] || 'relaxed';
    ['happy', 'sad', 'angry', 'surprised', 'relaxed'].forEach(k => {
      try { currentVrm.expressionManager.setValue(k, 0); } catch(e) {}
    });
    try { currentVrm.expressionManager.setValue(preset, 0.85); } catch(e) {}
  }
}

function showBubble(text, emotionKey = 'senyum_lembut') {
  if (bubbleTypewriterTimer) {
    clearInterval(bubbleTypewriterTimer);
    bubbleTypewriterTimer = null;
  }

  applyEmotion(emotionKey);
  bubbleContainer.style.opacity = '1';
  bubbleContainer.style.transform = 'translateY(0)';

  // If text contains HTML tags (e.g. <strong>, <code>, <br>), render directly to avoid mangling characters
  if (/<[a-z][\s\S]*>/i.test(text)) {
    bubbleText.innerHTML = text;
    startLipSync();
    setTimeout(() => {
      stopLipSync();
    }, Math.min(Math.max(text.length * 20, 1200), 4000));
    return;
  }

  // Typewriter effect in speech bubble for clean plain text
  bubbleText.textContent = '';
  startLipSync();

  let index = 0;
  const speed = 25; // ms per char

  bubbleTypewriterTimer = setInterval(() => {
    if (index < text.length) {
      bubbleText.textContent += text.charAt(index);
      index++;
    } else {
      clearInterval(bubbleTypewriterTimer);
      bubbleTypewriterTimer = null;
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

    apiStatusIndicator.innerHTML = `<i class="fa-solid fa-circle-check"></i> Online • ${data.engine || 'Antigravity Agentic'}`;
    apiStatusIndicator.className = 'api-status ok';
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
    if (activeEngine === 'live2d' && currentModel) {
      positionModel(currentModel);
    } else if (activeEngine === 'vrm' && currentVrm && vrmCamera) {
      vrmCamera.position.set(0, 1.10, 2.3);
      vrmCamera.lookAt(0, 0.95, 0);
      currentVrm.scene.rotation.set(0, 0, 0);
    }
  });

  // Toggle speech bubble
  btnToggleBubble.addEventListener('click', () => {
    const isHidden = bubbleContainer.style.display === 'none';
    bubbleContainer.style.display = isHidden ? 'block' : 'none';
  });

  // Settings modal
  btnSettings.addEventListener('click', async () => {
    await loadAvatarsList();
    settingsModal.classList.add('active');
  });

  const closeModal = () => settingsModal.classList.remove('active');
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelSettings.addEventListener('click', closeModal);

  // Switch model on selection change
  if (selectLive2D) {
    selectLive2D.addEventListener('change', async () => {
      const selectedPath = selectLive2D.value;
      if (!selectedPath) return;
      await switchAvatar(selectedPath);
    });
  }

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

    try {
      const payload = { model: model };
      if (key) {
        payload.apiKey = key;
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
window.addEventListener('DOMContentLoaded', async () => {
  vrmCanvas = document.getElementById('vrm-canvas');
  await loadAvatarsList();
  const savedPath = localStorage.getItem('preferred_avatar_path');
  const matchedAv = savedPath ? availableAvatars.find(a => a.path === savedPath) : null;

  if (matchedAv && matchedAv.type === 'vrm') {
    await initPixi();
    setupEventListeners();
    checkApiStatus();
    await switchAvatar(matchedAv.path);
  } else {
    if (matchedAv && matchedAv.type === 'live2d') {
      defaultModelPath = matchedAv.path;
    }
    await initPixi();
    setupEventListeners();
    checkApiStatus();
  }
});
