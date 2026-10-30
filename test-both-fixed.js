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

  await win.loadURL('http://localhost:3000/desktop.html');
  await new Promise(r => setTimeout(r, 2000));

  // Test Shizuku with new positioning
  console.log('Testing Shizuku new positioning...');
  await win.webContents.executeJavaScript(`switchAvatar('shizuku')`);
  await new Promise(r => setTimeout(r, 2000));

  await win.webContents.executeJavaScript(`
    (() => {
      if (currentModel) {
        const isHalfBody = (currentModel.height / currentModel.width) < 1.4;
        const scale = (260 * 0.72) / currentModel.width;
        currentModel.scale.set(scale);
        currentModel.anchor.set(0.5, 0.5);
        currentModel.x = 260 * 0.5;
        currentModel.y = 540 * 0.58;
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));
  let img = await win.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/test-shizuku-fixed.png', img.toPNG());

  // Test Seed-san with new camera and arm relaxation
  console.log('Testing Seed-san new camera and arms...');
  await win.webContents.executeJavaScript(`switchAvatar('seed-san')`);
  await new Promise(r => setTimeout(r, 2500));

  await win.webContents.executeJavaScript(`
    (() => {
      vrmCamera.position.set(0, 1.15, 2.2);
      vrmCamera.lookAt(0, 0.98, 0);

      if (currentVrm && currentVrm.humanoid) {
        const l = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const r = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (l) {
          l.rotation.z = -1.25;
          l.rotation.x = 0.15;
        }
        if (r) {
          r.rotation.z = 1.25;
          r.rotation.x = 0.15;
        }
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));
  img = await win.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/test-seed-fixed.png', img.toPNG());

  app.quit();
});
