const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'x11');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 260,
    height: 540,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  win.webContents.on('console-message', (e, level, msg) => console.log('RENDERER:', msg));

  await win.loadURL('http://localhost:3000/desktop.html');
  await new Promise(r => setTimeout(r, 2000));

  await win.webContents.executeJavaScript(`switchAvatar('seed-san')`);
  await new Promise(r => setTimeout(r, 2500));

  const result = await win.webContents.executeJavaScript(`
    (() => {
      try {
        vrmCamera.position.set(0, 1.25, 2.2);
        vrmCamera.lookAt(0, 1.05, 0);

        if (currentVrm && currentVrm.humanoid) {
          const l = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
          const r = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
          if (l) l.rotation.z = -1.25;
          if (r) r.rotation.z = 1.25;
        }
        return { success: true };
      } catch(e) {
        return { success: false, error: e.message };
      }
    })()
  `);
  console.log('Result:', result);

  await new Promise(r => setTimeout(r, 1000));
  let img = await win.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/seed-arms-fixed.png', img.toPNG());

  app.quit();
});
