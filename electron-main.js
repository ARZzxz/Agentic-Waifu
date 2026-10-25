const { app, BrowserWindow, screen, ipcMain, Tray, Menu } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'x11');

let mainWindow = null;
let tray = null;
let isGhostMode = false;
let currentPosition = 'right_bottom'; // 'right_bottom' | 'left_bottom'

// Slim width: only covers the avatar itself (250px) so it never blocks adjacent windows!
const WIN_WIDTH = 250;
const WIN_HEIGHT = 530;

function calculateBounds(posKey) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  let x, y;
  switch (posKey) {
    case 'left_bottom':
      x = workArea.x + 10;
      y = workArea.y + workArea.height - WIN_HEIGHT;
      break;
    case 'left_center':
      x = workArea.x + 10;
      y = workArea.y + Math.round((workArea.height - WIN_HEIGHT) / 2);
      break;
    case 'right_center':
      x = workArea.x + workArea.width - WIN_WIDTH - 10;
      y = workArea.y + Math.round((workArea.height - WIN_HEIGHT) / 2);
      break;
    case 'right_bottom':
    default:
      x = workArea.x + workArea.width - WIN_WIDTH - 10;
      y = workArea.y + workArea.height - WIN_HEIGHT;
      break;
  }

  return { x, y, width: WIN_WIDTH, height: WIN_HEIGHT };
}

function createWindow() {
  const bounds = calculateBounds(currentPosition);

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    type: 'toolbar',
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  mainWindow.setSkipTaskbar(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadURL('http://localhost:3000/desktop.html');

  // Handle explicit ghost mode toggle
  ipcMain.on('set-ghost-mode', (event, active) => {
    isGhostMode = active;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(isGhostMode, { forward: false });
    }
    updateTrayMenu();
  });

  // Switch corner (Dodge)
  ipcMain.on('dodge-corner', () => {
    currentPosition = currentPosition === 'right_bottom' ? 'left_bottom' : 'right_bottom';
    setPosition(currentPosition);
  });

  // Explicit reposition
  ipcMain.on('reposition-corner', (event, pos) => {
    setPosition(pos);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createTray();
}

function setPosition(posKey) {
  currentPosition = posKey;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const b = calculateBounds(posKey);
    mainWindow.setBounds(b);
  }
  updateTrayMenu();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
  updateTrayMenu();
}

function toggleGhost() {
  isGhostMode = !isGhostMode;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('toggle-ghost-state', isGhostMode);
    mainWindow.setIgnoreMouseEvents(isGhostMode, { forward: false });
  }
  updateTrayMenu();
}

function buildMenuTemplate() {
  const isVis = mainWindow && mainWindow.isVisible();

  return [
    {
      label: isVis ? '👁️ Sembunyikan Akeno' : '👁️ Tampilkan Akeno',
      click: () => toggleWindow()
    },
    {
      label: '⇄ Pindah Sisi (Dodge Kiri / Kanan)',
      click: () => {
        currentPosition = currentPosition === 'right_bottom' ? 'left_bottom' : 'right_bottom';
        setPosition(currentPosition);
      }
    },
    {
      label: isGhostMode ? '✨ Matikan Mode Tembus' : '👻 Mode Tembus (Ghost Mode)',
      click: () => toggleGhost()
    },
    { type: 'separator' },
    {
      label: '📍 Posisi Layar',
      submenu: [
        {
          label: '↘️ Pojok Kanan Bawah (Default)',
          type: 'radio',
          checked: currentPosition === 'right_bottom',
          click: () => setPosition('right_bottom')
        },
        {
          label: '↙️ Pojok Kiri Bawah',
          type: 'radio',
          checked: currentPosition === 'left_bottom',
          click: () => setPosition('left_bottom')
        },
        {
          label: '➡️ Tepi Kanan Tengah',
          type: 'radio',
          checked: currentPosition === 'right_center',
          click: () => setPosition('right_center')
        },
        {
          label: '⬅️ Tepi Kiri Tengah',
          type: 'radio',
          checked: currentPosition === 'left_center',
          click: () => setPosition('left_center')
        }
      ]
    },
    { type: 'separator' },
    {
      label: '🌐 Buka Pengaturan di Browser',
      click: () => {
        const { shell } = require('electron');
        shell.openExternal('http://localhost:3000');
      }
    },
    { type: 'separator' },
    {
      label: '❌ Tutup Akeno',
      click: () => {
        app.quit();
      }
    }
  ];
}

function updateTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
  }
}

function createTray() {
  if (tray) return;

  const trayIconPath = path.join(__dirname, 'public', 'tray.png');
  try {
    tray = new Tray(trayIconPath);
    tray.setToolTip('Akeno AI Companion\nKlik untuk toggle');
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
    tray.on('click', () => toggleWindow());
  } catch (err) {
    console.warn('Tray creation failed:', err.message);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
