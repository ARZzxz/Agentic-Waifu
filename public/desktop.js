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
let isWideMode = false;
let isMinimized = true; // Starts minimized for clean desktop companion feel
let currentPosition = 'right_bottom';
let sessionHistory = [];
const defaultModelPath = 'models/haru/haru_greeter_t03.model3.json';

// Avatars Catalog & Multi-Format Engine (Live2D & 3D VRM)
let activeEngine = 'live2d'; // 'live2d' | 'vrm'
let currentAvatarIndex = 0;
const AVATARS = [
  { id: 'haru', name: 'Akeno (Haru Live2D)', type: 'live2d', path: 'models/haru/haru_greeter_t03.model3.json' },
  { id: 'shizuku', name: 'Shizuku (Live2D)', type: 'live2d', path: 'models/shizuku/shizuku.model.json' },
  { id: 'seed-san', name: 'Seed-san (3D VRM)', type: 'vrm', path: 'models/vrm/seed-san.vrm' }
];

// DOM Elements
const layout = document.getElementById('companion-layout');
const canvas = document.getElementById('live2d-canvas');
const vrmCanvas = document.getElementById('vrm-canvas');
const speechBubble = document.getElementById('speech-bubble');
const bubbleEmotion = document.getElementById('bubble-emotion');
const bubbleText = document.getElementById('bubble-text');
const bubbleProcess = document.getElementById('bubble-process');
const bubbleProcessLabel = document.getElementById('bubble-process-label');
const btnBubbleExpand = document.getElementById('btn-bubble-expand');
const btnBubbleClose = document.getElementById('btn-bubble-close');

const minimizedBar = document.getElementById('minimized-bar');
const minimizedLabel = document.getElementById('minimized-label');
const btnExpandPanel = document.getElementById('btn-expand-panel');
const btnDodgeMini = document.getElementById('btn-dodge-mini');

const sessionPanel = document.getElementById('session-panel');
const sessionHistoryEl = document.getElementById('session-history');
const sessionInput = document.getElementById('session-input');
const btnSessionSend = document.getElementById('btn-session-send');
const sessionTopicText = document.getElementById('session-topic-text');
const btnToggleAvatar = document.getElementById('btn-toggle-avatar');
const processIndicator = document.getElementById('process-indicator');
const processLabel = document.getElementById('process-label');
const btnToggleWide = document.getElementById('btn-toggle-wide');
const wideIcon = document.getElementById('wide-icon');
const btnClearSession = document.getElementById('btn-clear-session');
const btnDodge = document.getElementById('btn-dodge');
const btnMinimizePanel = document.getElementById('btn-minimize-panel');

const slashAutocomplete = document.getElementById('slash-autocomplete');
const slashList = document.getElementById('slash-list');

// Emotion configurations
const EMOTIONS = {
  goda: { label: 'Ara ara~', icon: 'fa-heart-circle-bolt', motion: 'Tap' },
  senyum_lembut: { label: 'Senyum', icon: 'fa-heart', motion: 'Idle' },
  fokus: { label: 'Fokus', icon: 'fa-magnifying-glass', motion: 'Idle' },
  senang: { label: 'Senang', icon: 'fa-face-smile-wink', motion: 'Tap' },
  khawatir: { label: 'Khawatir', icon: 'fa-hand-holding-heart', motion: 'Idle' },
  berpikir: { label: 'Berpikir...', icon: 'fa-brain', motion: 'Idle' }
};

// Slash Commands Definition for Antigravity Autocomplete Menu
const SLASH_COMMANDS = [
  { cmd: '/resume', icon: '🔄', desc: 'Resume & masuk ke sesi percakapan terakhir', takesArg: false },
  { cmd: '/new', icon: '✨', desc: 'Mulai sesi percakapan & tugas baru', takesArg: false },
  { cmd: '/avatar', icon: '👤', desc: 'Ganti avatar visual (Haru, Shizuku, Seed-san 3D VRM)', takesArg: true },
  { cmd: '/usage', icon: '⚡', desc: 'Cek sisa kuota model AI (Gemini & Claude)', takesArg: false },
  { cmd: '/help', icon: '📖', desc: 'Lihat daftar lengkap perintah & bantuan', takesArg: false },
  { cmd: '/plan', icon: '📋', desc: 'Buat rencana langkah terstruktur sebelum eksekusi', takesArg: true },
  { cmd: '/goal', icon: '🎯', desc: 'Jalankan tugas mendalam tanpa henti (autonomous mode)', takesArg: true },
  { cmd: '/browser', icon: '🌐', desc: 'Berselancar dan cari informasi di web', takesArg: true },
  { cmd: '/teamwork', icon: '🤝', desc: 'Jalankan kolaborasi tim multi-agent', takesArg: true },
  { cmd: '/boost', icon: '🚀', desc: 'Mode penalaran intensif & verifikasi ketat', takesArg: true },
  { cmd: '/grill-me', icon: '🔥', desc: 'Tanya jawab kritis menguji asumsi rencana', takesArg: true },
  { cmd: '/learn', icon: '🧠', desc: 'Simpan instruksi agar kuingat permanen', takesArg: true },
  { cmd: '/skills', icon: '🛠️', desc: 'Lihat daftar skills yang terpasang', takesArg: false },
  { cmd: '/agents', icon: '🤖', desc: 'Lihat daftar subagent yang tersedia', takesArg: false },
  { cmd: '/models', icon: '🔮', desc: 'Lihat model AI Antigravity yang tersedia', takesArg: false },
  { cmd: '/mcp', icon: '🔌', desc: 'Cek status server MCP', takesArg: false },
  { cmd: '/changelog', icon: '📦', desc: 'Lihat catatan rilis terbaru Antigravity', takesArg: false },
  { cmd: '/clear', icon: '🗑️', desc: 'Bersihkan tampilan riwayat sesi di layar', takesArg: false },
  { cmd: '/sleep', icon: '💤', desc: 'Tidurkan laptop (suspend)', takesArg: false },
  { cmd: '/restart', icon: '🔄', desc: 'Nyalakan ulang laptop (reboot)', takesArg: false },
  { cmd: '/shutdown', icon: '⚡', desc: 'Matikan daya laptop (poweroff)', takesArg: false }
];

let selectedAutocompleteIndex = 0;
let filteredCommands = [];

// 1. Initialize PixiJS for Slim/Wide Canvas
async function initPixi() {
  const width = 260;
  const height = 540;

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
  await loadLive2DModel(defaultModelPath);
}

async function loadLive2DModel(modelPath) {
  if (!app) return;
  if (currentModel) {
    try {
      app.stage.removeChild(currentModel);
      currentModel.destroy();
    } catch(e) {}
    currentModel = null;
  }

  const height = 540;
  const width = 260;

  try {
    const model = await PIXI.live2d.Live2DModel.from(modelPath, {
      autoInteract: true
    });

    currentModel = model;
    app.stage.addChild(model);

    // Scale and position model: Face & chest high up
    const scale = (height / model.height) * 0.95;
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.x = width * 0.5;
    model.y = height * 0.48;

    console.log('Live2D Model Loaded:', modelPath);
  } catch (err) {
    console.error('Failed to load Live2D model:', err);
  }
}

// 1B. Initialize Three.js + VRM 3D Engine
let vrmRenderer = null;
let vrmScene = null;
let vrmCamera = null;
let currentVrm = null;
let vrmClock = null;
let vrmAnimationId = null;
let vrmBlinkTimer = null;

function initVrmEngine() {
  if (vrmRenderer) return;
  const stage = document.getElementById('avatar-stage');
  const width = stage.clientWidth || 260;
  const height = stage.clientHeight || 540;

  vrmClock = new THREE.Clock();
  vrmScene = new THREE.Scene();

  vrmCamera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
  vrmCamera.position.set(0, 1.35, 1.15);
  vrmCamera.lookAt(0, 1.28, 0);

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
  const stage = document.getElementById('avatar-stage');
  const width = stage.clientWidth || 260;
  const height = stage.clientHeight || 540;
  vrmCamera.aspect = width / height;
  vrmCamera.updateProjectionMatrix();
  vrmRenderer.setSize(width, height);
}

async function loadVrmModel(url) {
  initVrmEngine();
  const loader = new THREE.GLTFLoader();
  loader.register((parser) => new THREE_VRM.VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        if (!vrm) return reject(new Error('No VRM found in model file'));

        if (currentVrm) {
          vrmScene.remove(currentVrm.scene);
          THREE_VRM.VRMUtils.deepDispose(currentVrm.scene);
          currentVrm = null;
        }

        currentVrm = vrm;
        vrmScene.add(vrm.scene);

        // Turn around to face camera (+Z)
        vrm.scene.rotation.y = Math.PI;

        // Relax arms from T-pose
        if (vrm.humanoid) {
          try {
            const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
            if (leftUpperArm) leftUpperArm.rotation.z = 1.15;
            if (rightUpperArm) rightUpperArm.rotation.z = -1.15;
          } catch(e) {}
        }

        startVrmLoop();
        startVrmBlinking();
        console.log('VRM Model Loaded successfully:', url);
        resolve(vrm);
      },
      undefined,
      (err) => {
        console.error('Failed to load VRM model:', err);
        reject(err);
      }
    );
  });
}

function startVrmBlinking() {
  if (vrmBlinkTimer) clearInterval(vrmBlinkTimer);
  vrmBlinkTimer = setInterval(() => {
    if (!currentVrm || !currentVrm.expressionManager) return;
    currentVrm.expressionManager.setValue('blink', 1.0);
    setTimeout(() => {
      if (currentVrm && currentVrm.expressionManager) {
        currentVrm.expressionManager.setValue('blink', 0.0);
      }
    }, 130);
  }, 4000);
}

function startVrmLoop() {
  if (vrmAnimationId) return;
  function animate() {
    vrmAnimationId = requestAnimationFrame(animate);
    if (activeEngine !== 'vrm') return;
    const delta = vrmClock ? vrmClock.getDelta() : 0.016;
    const time = vrmClock ? vrmClock.getElapsedTime() : Date.now() * 0.001;

    if (currentVrm) {
      if (currentVrm.humanoid) {
        try {
          const chest = currentVrm.humanoid.getNormalizedBoneNode('chest') || currentVrm.humanoid.getNormalizedBoneNode('spine');
          if (chest) {
            chest.rotation.x = Math.sin(time * 1.5) * 0.02;
          }
        } catch(e) {}
      }
      currentVrm.update(delta);
    }
    if (vrmRenderer && vrmScene && vrmCamera) {
      vrmRenderer.render(vrmScene, vrmCamera);
    }
  }
  animate();
}

// 1C. Avatar Switcher (Live2D & 3D VRM)
async function switchAvatar(targetId) {
  const q = (targetId || '').toLowerCase().trim();
  const av = AVATARS.find(a => a.id === q || a.name.toLowerCase().includes(q)) || AVATARS[0];
  currentAvatarIndex = AVATARS.indexOf(av);
  localStorage.setItem('preferred_avatar', av.id);

  if (av.type === 'live2d') {
    activeEngine = 'live2d';
    if (vrmCanvas) vrmCanvas.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
    await loadLive2DModel(av.path);
  } else if (av.type === 'vrm') {
    activeEngine = 'vrm';
    if (canvas) canvas.style.display = 'none';
    if (vrmCanvas) vrmCanvas.style.display = 'block';
    await loadVrmModel(av.path);
  }

  showSpeechBubble(`Model visual berhasil beralih ke <strong>${av.name}</strong> (${av.type.toUpperCase()})!`, 'senyum_lembut');
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
  if (activeEngine === 'live2d') {
    if (!currentModel || !currentModel.internalModel) return;
    try {
      const core = currentModel.internalModel.coreModel;
      if (core && core.setParameterValueById) {
        core.setParameterValueById('ParamMouthOpenY', val);
      }
    } catch (e) {}
  } else if (activeEngine === 'vrm') {
    if (currentVrm && currentVrm.expressionManager) {
      try {
        currentVrm.expressionManager.setValue('aa', val);
      } catch (e) {}
    }
  }
}

// 3. Simple Markdown Formatter for Code, Bold, & Codeblocks
function formatMarkdown(text) {
  if (!text) return '';
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Triple backticks code block
  escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Newlines
  escaped = escaped.replace(/\n/g, '<br>');

  return escaped;
}

// 4. Append to Session History
function appendHistoryItem(role, content, emotionKey = null, isProcess = false) {
  const card = document.createElement('div');
  card.className = `history-card ${role} ${isProcess ? 'process' : ''}`;

  if (role === 'akeno') {
    const emo = EMOTIONS[emotionKey] || EMOTIONS.senyum_lembut;
    card.innerHTML = `
      <div class="card-meta"><i class="fa-solid ${emo.icon}"></i> Akeno • ${emo.label}</div>
      <div class="card-body">${formatMarkdown(content)}</div>
    `;
  } else if (role === 'user') {
    card.innerHTML = `
      <div class="card-meta"><i class="fa-solid fa-user"></i> Kamu</div>
      <div class="card-body">${formatMarkdown(content)}</div>
    `;
  } else if (role === 'process') {
    card.innerHTML = `
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <span>${formatMarkdown(content)}</span>
    `;
  }

  sessionHistoryEl.appendChild(card);
  sessionHistoryEl.scrollTop = sessionHistoryEl.scrollHeight;
  return card;
}

// 5. Speech Bubble & Voice
function showSpeechBubble(text, emotionKey = 'senyum_lembut') {
  const emo = EMOTIONS[emotionKey] || EMOTIONS.senyum_lembut;
  bubbleEmotion.innerHTML = `<i class="fa-solid ${emo.icon}"></i> Akeno • ${emo.label}`;
  bubbleText.innerHTML = formatMarkdown(text);
  speechBubble.classList.remove('hidden');
}

function hideSpeechBubble() {
  speechBubble.classList.add('hidden');
  minimizedLabel.textContent = 'Tanya Agent';
}

function triggerAkenoVoice(text, emotionKey = 'senyum_lembut') {
  const emo = EMOTIONS[emotionKey] || EMOTIONS.senyum_lembut;
  if (activeEngine === 'live2d' && currentModel && emo.motion && currentModel.motion) {
    try { currentModel.motion(emo.motion); } catch (e) {}
  } else if (activeEngine === 'vrm' && currentVrm && currentVrm.expressionManager) {
    try {
      currentVrm.expressionManager.setValue('happy', 0);
      currentVrm.expressionManager.setValue('sad', 0);
      currentVrm.expressionManager.setValue('relaxed', 0);
      currentVrm.expressionManager.setValue('surprised', 0);

      if (emotionKey === 'goda' || emotionKey === 'senang') {
        currentVrm.expressionManager.setValue('happy', 0.85);
      } else if (emotionKey === 'senyum_lembut') {
        currentVrm.expressionManager.setValue('happy', 0.5);
      } else if (emotionKey === 'khawatir') {
        currentVrm.expressionManager.setValue('sad', 0.7);
      } else if (emotionKey === 'fokus' || emotionKey === 'berpikir') {
        currentVrm.expressionManager.setValue('relaxed', 0.5);
      }
    } catch (e) {}
  }

  startLipSync();
  const duration = Math.min(Math.max(text.length * 25, 2000), 10000);
  setTimeout(() => {
    stopLipSync();
    if (activeEngine === 'vrm' && currentVrm && currentVrm.expressionManager) {
      try {
        currentVrm.expressionManager.setValue('happy', 0);
        currentVrm.expressionManager.setValue('sad', 0);
        currentVrm.expressionManager.setValue('relaxed', 0);
      } catch (e) {}
    }
  }, duration);
}

// 6. Panel Expand & Minimize Controls
function expandPanel() {
  isMinimized = false;
  layout.classList.remove('is-minimized');
  hideSpeechBubble();
  sessionInput.focus();
  sessionHistoryEl.scrollTop = sessionHistoryEl.scrollHeight;
}

function minimizePanel() {
  isMinimized = true;
  layout.classList.add('is-minimized');
  minimizedLabel.textContent = 'Tanya Agent';

  if (slashAutocomplete) {
    slashAutocomplete.classList.add('hidden');
  }

  // If in wide mode, revert to slim 260px when minimizing so no ghost area blocks desktop
  if (isWideMode) {
    toggleWideMode(false);
  }
}

function toggleWideMode(forceState = null) {
  isWideMode = forceState !== null ? forceState : !isWideMode;

  if (isWideMode) {
    expandPanel();
    layout.classList.add('wide-mode');
    layout.classList.remove('slim-mode');
    wideIcon.className = 'fa-solid fa-compress';
    if (ipcRenderer) ipcRenderer.send('set-window-mode', 'wide');
  } else {
    layout.classList.add('slim-mode');
    layout.classList.remove('wide-mode');
    wideIcon.className = 'fa-solid fa-expand';
    if (ipcRenderer) ipcRenderer.send('set-window-mode', 'slim');
  }
}

// 7. Slash Autocomplete & Session Picker Methods
let cachedSessions = null;

async function loadAndShowResumeSessions(filterText = '') {
  try {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      cachedSessions = await res.json();
    }
  } catch(e) {}

  const sessions = cachedSessions || [];
  const q = filterText.toLowerCase().trim();

  // Create list of choices
  const choices = [
    {
      cmd: '/resume latest',
      id: 'latest',
      isSession: true,
      icon: '⚡',
      title: 'Sesi Paling Baru (Terakhir)',
      desc: 'Lanjutkan sesi percakapan paling baru'
    }
  ];

  sessions.forEach(s => {
    choices.push({
      cmd: `/resume ${s.shortId}`,
      id: s.shortId,
      fullId: s.id,
      isSession: true,
      icon: '💬',
      title: s.title,
      desc: `[${s.time}] ${s.title} (${s.count} pesan)`
    });
  });

  filteredCommands = choices.filter(c => {
    return c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
  });

  if (filteredCommands.length === 0) {
    slashAutocomplete.classList.add('hidden');
    return;
  }

  selectedAutocompleteIndex = 0;
  slashList.innerHTML = '';

  // Header for session selection
  const headerEl = slashAutocomplete.querySelector('.slash-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <span><i class="fa-solid fa-clock-rotate-left"></i> Pilih Sesi Chat untuk Di-resume</span>
      <span class="slash-hint">↑↓ pilih • Tab/Enter pilih sesi</span>
    `;
  }

  filteredCommands.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = `slash-item ${index === 0 ? 'selected' : ''}`;
    el.dataset.index = index;
    el.innerHTML = `
      <span class="slash-item-icon">${item.icon}</span>
      <span class="slash-item-cmd">${item.cmd}</span>
      <span class="slash-item-desc">${item.desc}</span>
    `;

    el.addEventListener('mouseenter', () => {
      setAutocompleteSelected(index);
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      chooseAutocompleteCommand(item);
    });

    slashList.appendChild(el);
  });

  slashAutocomplete.classList.remove('hidden');
}

function loadAndShowAvatarChoices(filterText = '') {
  const choices = AVATARS.map(a => ({
    cmd: `/avatar ${a.id}`,
    id: a.id,
    icon: a.type === 'vrm' ? '🧊' : '🎨',
    desc: `${a.name} (${a.type.toUpperCase()})`
  }));

  const q = filterText.toLowerCase().trim();
  filteredCommands = choices.filter(c => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));

  if (filteredCommands.length === 0) {
    slashAutocomplete.classList.add('hidden');
    return;
  }

  selectedAutocompleteIndex = 0;
  slashList.innerHTML = '';

  const headerEl = slashAutocomplete.querySelector('.slash-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <span><i class="fa-solid fa-user-astronaut"></i> Pilih Model Visual Avatar</span>
      <span class="slash-hint">↑↓ pilih • Tab/Enter ganti</span>
    `;
  }

  filteredCommands.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = `slash-item ${index === 0 ? 'selected' : ''}`;
    el.dataset.index = index;
    el.innerHTML = `
      <span class="slash-item-icon">${item.icon}</span>
      <span class="slash-item-cmd">${item.cmd}</span>
      <span class="slash-item-desc">${item.desc}</span>
    `;

    el.addEventListener('mouseenter', () => {
      setAutocompleteSelected(index);
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      chooseAutocompleteCommand(item);
    });

    slashList.appendChild(el);
  });

  slashAutocomplete.classList.remove('hidden');
}

function renderAutocomplete(filterText = '') {
  const query = filterText.toLowerCase().trim();
  filteredCommands = SLASH_COMMANDS.filter(c => {
    return c.cmd.toLowerCase().includes(query) || c.desc.toLowerCase().includes(query);
  });

  if (filteredCommands.length === 0) {
    slashAutocomplete.classList.add('hidden');
    return;
  }

  selectedAutocompleteIndex = 0;
  slashList.innerHTML = '';

  const headerEl = slashAutocomplete.querySelector('.slash-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <span><i class="fa-solid fa-terminal"></i> Perintah Antigravity</span>
      <span class="slash-hint">↑↓ pilih • Tab/Enter lengkapi</span>
    `;
  }

  filteredCommands.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = `slash-item ${index === 0 ? 'selected' : ''}`;
    el.dataset.index = index;
    el.innerHTML = `
      <span class="slash-item-icon">${item.icon}</span>
      <span class="slash-item-cmd">${item.cmd}</span>
      <span class="slash-item-desc">${item.desc}</span>
    `;

    el.addEventListener('mouseenter', () => {
      setAutocompleteSelected(index);
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      chooseAutocompleteCommand(item);
    });

    slashList.appendChild(el);
  });

  slashAutocomplete.classList.remove('hidden');
}

function setAutocompleteSelected(index) {
  selectedAutocompleteIndex = index;
  const items = slashList.querySelectorAll('.slash-item');
  items.forEach((item, i) => {
    if (i === index) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function chooseAutocompleteCommand(item) {
  // If choosing a session from the /resume submenu
  if (item.isSession) {
    sessionInput.value = `/resume ${item.id} `;
    slashAutocomplete.classList.add('hidden');
    sessionInput.focus();
    return;
  }

  // If user chooses /resume from the main menu, open the sessions submenu
  if (item.cmd === '/resume') {
    sessionInput.value = '/resume ';
    sessionInput.focus();
    loadAndShowResumeSessions('');
    return;
  }

  // If user chooses /avatar from the main menu, open avatar choices submenu
  if (item.cmd === '/avatar') {
    sessionInput.value = '/avatar ';
    sessionInput.focus();
    loadAndShowAvatarChoices('');
    return;
  }

  // For all commands: autocomplete into input with trailing space, DO NOT auto-send!
  sessionInput.value = item.cmd + ' ';
  slashAutocomplete.classList.add('hidden');
  sessionInput.focus();
}

// 8. Send Command or Chat Message
async function sendMessage(inputOverride = null) {
  const text = (inputOverride || sessionInput.value).trim();
  if (!text) return;

  if (!inputOverride) sessionInput.value = '';
  slashAutocomplete.classList.add('hidden');

  // Append user message
  appendHistoryItem('user', text);
  sessionHistory.push({ role: 'user', text });

  // Show live process indicator
  processIndicator.classList.remove('hidden');
  processLabel.textContent = 'Menjalankan tugas Antigravity...';

  // Also show on minimized bubble if minimized
  if (isMinimized) {
    bubbleProcess.classList.remove('hidden');
    bubbleProcessLabel.textContent = `⚡ [Antigravity] ${text.slice(0, 30)}...`;
    speechBubble.classList.remove('hidden');
  }

  const processCard = appendHistoryItem('process', `⚡ [Antigravity] Mengeksekusi: ${text.slice(0, 45)}...`);

  if (currentModel && currentModel.motion) {
    try { currentModel.motion('Idle'); } catch (e) {}
  }

  btnSessionSend.disabled = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: sessionHistory })
    });

    const data = await res.json();
    processCard.remove();
    processIndicator.classList.add('hidden');
    bubbleProcess.classList.add('hidden');

    if (res.ok) {
      if (data.sessionTitle && sessionTopicText) {
        sessionTopicText.textContent = data.sessionTitle;
      }

      if (data.isAvatarSwitch && data.targetAvatar) {
        switchAvatar(data.targetAvatar);
      }

      if (data.isNew) {
        // Clear history on /new
        sessionHistory = [];
        sessionHistoryEl.innerHTML = '';
        if (sessionTopicText) sessionTopicText.textContent = 'Sesi Baru';
      } else if (data.isResume && data.history) {
        sessionHistory = data.history;
        sessionHistoryEl.innerHTML = '';
        data.history.forEach(item => {
          appendHistoryItem(item.role === 'user' ? 'user' : 'akeno', item.text, item.emotion || 'senyum_lembut');
        });
      }

      sessionHistory.push({ role: 'assistant', text: data.reply });
      appendHistoryItem('akeno', data.reply, data.emotion || 'senyum_lembut');
      triggerAkenoVoice(data.reply, data.emotion || 'senyum_lembut');

      if (isMinimized) {
        showSpeechBubble(data.reply, data.emotion || 'senyum_lembut');
      }
    } else {
      const errMsg = `Ara ara... ada kendala: ${data.error}`;
      appendHistoryItem('akeno', errMsg, 'khawatir');
      triggerAkenoVoice(errMsg, 'khawatir');
      if (isMinimized) showSpeechBubble(errMsg, 'khawatir');
    }
  } catch (err) {
    processCard.remove();
    processIndicator.classList.add('hidden');
    bubbleProcess.classList.add('hidden');
    const errMsg = `Koneksi terputus: ${err.message}`;
    appendHistoryItem('akeno', errMsg, 'khawatir');
    triggerAkenoVoice(errMsg, 'khawatir');
    if (isMinimized) showSpeechBubble(errMsg, 'khawatir');
  } finally {
    btnSessionSend.disabled = false;
  }
}

// 9. Initial Session Resume Loader (Auto /resume on Startup)
async function initSession() {
  try {
    const res = await fetch('/api/session');
    if (!res.ok) return;
    const session = await res.json();

    if (session.title && sessionTopicText) {
      sessionTopicText.textContent = session.title;
    }

    const savedAvatar = localStorage.getItem('preferred_avatar');
    if (savedAvatar && savedAvatar !== 'haru') {
      setTimeout(() => switchAvatar(savedAvatar), 500);
    }

    if (session.history && session.history.length > 0) {
      sessionHistory = session.history;
      sessionHistoryEl.innerHTML = '';

      // Re-render previous history turns
      session.history.forEach(item => {
        appendHistoryItem(item.role === 'user' ? 'user' : 'akeno', item.text, item.emotion || 'senyum_lembut');
      });

      // Add system resume notification badge in history
      const resumeNotice = document.createElement('div');
      resumeNotice.className = 'history-card process';
      resumeNotice.innerHTML = `
        <i class="fa-solid fa-rotate-left"></i>
        <span><strong>[Sesi Di-resume]</strong> Melanjutkan sesi percakapan terakhir (${session.history.length} pesan dimuat). Ketik <code>/new</code> untuk mulai dari awal.</span>
      `;
      sessionHistoryEl.appendChild(resumeNotice);
      sessionHistoryEl.scrollTop = sessionHistoryEl.scrollHeight;

      // Greet user with warm resume message
      const resumeGreeting = `Ara ara~ Selamat datang kembali sayang! Aku sudah me-resume sesi percakapan terakhir kita. Ada tugas apa yang ingin kita lanjutkan bersama hari ini?`;
      showSpeechBubble(resumeGreeting, 'senyum_lembut');
      triggerAkenoVoice(resumeGreeting, 'senyum_lembut');
    } else {
      // Clean first-time welcome
      const welcome = `Ara ara~ Selamat datang! Aku adalah wadah visual resmi Antigravity. Ketik <code>/</code> untuk melihat semua perintah atau <code>/help</code> ya sayang~`;
      showSpeechBubble(welcome, 'senyum_lembut');
      triggerAkenoVoice(welcome, 'senyum_lembut');
    }
  } catch (e) {
    console.error('Gagal me-resume sesi:', e);
  }
}

// 10. Event Listeners & Panel Controls
function setupUIControls() {
  // Close / Minimize Chat Panel to Floating Pill
  const closeChatPanel = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    minimizePanel();
  };
  btnMinimizePanel.addEventListener('click', closeChatPanel);
  btnMinimizePanel.addEventListener('pointerdown', closeChatPanel);

  // Expand Panel from Minimized Pill
  btnExpandPanel.addEventListener('click', (e) => {
    e.stopPropagation();
    expandPanel();
  });

  // Expand Panel from Speech Bubble
  btnBubbleExpand.addEventListener('click', (e) => {
    e.stopPropagation();
    expandPanel();
  });

  // Close Speech Bubble ('x' button)
  const closeSpeechBubble = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    hideSpeechBubble();
  };
  btnBubbleClose.addEventListener('click', closeSpeechBubble);
  btnBubbleClose.addEventListener('pointerdown', closeSpeechBubble);

  // Toggle Wide / Slim Mode
  btnToggleWide.addEventListener('click', () => {
    toggleWideMode();
  });

  // Toggle Avatar (Live2D Haru / Shizuku / 3D VRM Seed-san)
  if (btnToggleAvatar) {
    btnToggleAvatar.addEventListener('click', () => {
      currentAvatarIndex = (currentAvatarIndex + 1) % AVATARS.length;
      switchAvatar(AVATARS[currentAvatarIndex].id);
    });
  }

  // Clear Session History (UI clear)
  btnClearSession.addEventListener('click', () => {
    sessionHistory = [];
    sessionHistoryEl.innerHTML = '';
    appendHistoryItem('akeno', 'Ara ara~ Tampilan riwayat chat telah dibersihkan. Jika ingin membuka sesi agentic baru dari awal, ketik `/new` ya sayang~', 'senang');
  });

  // Dodge Corner
  const doDodge = (e) => {
    e.stopPropagation();
    if (ipcRenderer) ipcRenderer.send('dodge-corner');
  };
  btnDodge.addEventListener('click', doDodge);
  btnDodgeMini.addEventListener('click', doDodge);

  // Send button & enter key
  btnSessionSend.addEventListener('click', () => sendMessage());

  // Input listeners for Slash Autocomplete Menu (Antigravity Style)
  sessionInput.addEventListener('input', () => {
    const val = sessionInput.value;
    if (val === '/resume' || val.startsWith('/resume')) {
      const filter = val.startsWith('/resume') ? val.slice(7).trim() : '';
      loadAndShowResumeSessions(filter);
    } else if (val === '/avatar' || val.startsWith('/avatar')) {
      const filter = val.startsWith('/avatar') ? val.slice(7).trim() : '';
      loadAndShowAvatarChoices(filter);
    } else if (val.startsWith('/')) {
      renderAutocomplete(val);
    } else {
      slashAutocomplete.classList.add('hidden');
    }
  });

  sessionInput.addEventListener('keydown', (e) => {
    // If autocomplete is visible, handle Arrow navigation, Enter, Tab, Escape
    if (!slashAutocomplete.classList.contains('hidden') && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (selectedAutocompleteIndex + 1) % filteredCommands.length;
        setAutocompleteSelected(next);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (selectedAutocompleteIndex - 1 + filteredCommands.length) % filteredCommands.length;
        setAutocompleteSelected(prev);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredCommands[selectedAutocompleteIndex];
        if (selected) {
          chooseAutocompleteCommand(selected);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        slashAutocomplete.classList.add('hidden');
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  // Hide autocomplete on click outside
  document.addEventListener('click', (e) => {
    if (!slashAutocomplete.contains(e.target) && e.target !== sessionInput) {
      slashAutocomplete.classList.add('hidden');
    }
  });

  // Quick Slash Command Chips
  document.querySelectorAll('.slash-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cmd = chip.dataset.cmd;
      if (cmd === '/resume') {
        sessionInput.value = '/resume ';
        sessionInput.focus();
        if (isMinimized) expandPanel();
        loadAndShowResumeSessions('');
      } else if (cmd === '/avatar') {
        sessionInput.value = '/avatar ';
        sessionInput.focus();
        if (isMinimized) expandPanel();
        loadAndShowAvatarChoices('');
      } else if (cmd.endsWith(' ')) {
        sessionInput.value = cmd;
        sessionInput.focus();
        if (isMinimized) expandPanel();
      } else {
        sessionInput.value = cmd + ' ';
        sessionInput.focus();
        if (isMinimized) expandPanel();
      }
    });
  });

  // IPC listeners from main Electron process
  if (ipcRenderer) {
    ipcRenderer.on('toggle-ghost-state', (event, active) => {
      isGhostMode = active;
      if (isGhostMode) layout.classList.add('ghost-mode');
      else layout.classList.remove('ghost-mode');
    });

    ipcRenderer.on('corner-changed', (event, pos) => {
      currentPosition = pos;
      if (pos.startsWith('left')) {
        layout.classList.add('pos-left');
        layout.classList.remove('pos-right');
      } else {
        layout.classList.add('pos-right');
        layout.classList.remove('pos-left');
      }
    });

    ipcRenderer.on('window-mode-changed', (event, mode) => {
      isWideMode = mode === 'wide';
      if (isWideMode) {
        layout.classList.add('wide-mode');
        layout.classList.remove('slim-mode');
        wideIcon.className = 'fa-solid fa-compress';
      } else {
        layout.classList.add('slim-mode');
        layout.classList.remove('wide-mode');
        wideIcon.className = 'fa-solid fa-expand';
      }
    });
  }
}

// Bootstrap Application
window.addEventListener('DOMContentLoaded', () => {
  initPixi();
  setupUIControls();
  initSession();
});
