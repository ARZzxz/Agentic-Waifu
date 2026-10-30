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

  await win.webContents.executeJavaScript(`switchAvatar('seed-san')`);
  await new Promise(r => setTimeout(r, 2500));

  // Test different camera and arm configs
  const configs = [
    { name: 'cam1_pos', cam: [0, 1.15, 1.9], look: [0, 1.05, 0], armZ: 1.15 },
    { name: 'cam2_pos', cam: [0, 1.15, 2.1], look: [0, 1.02, 0], armZ: 1.25 },
    { name: 'cam3_arms_down', cam: [0, 1.15, 2.0], look: [0, 1.02, 0], armZ: -1.25, testSign: true }
  ];

  for (const c of configs) {
    await win.webContents.executeJavaScript(`
      (() => {
        vrmCamera.position.set(${c.cam[0]}, ${c.cam[1]}, ${c.cam[2]});
        vrmCamera.lookAt(${c.look[0]}, ${c.look[1]}, ${c.look[2]});
        if (currentVrm && currentVrm.humanoid) {
          const l = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
          const r = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
          if (l && r) {
            if (${c.testSign}) {
              // Test negative vs positive
              l.rotation.z = -1.2;
              r.rotation.z = 1.2;
            } else {
              l.rotation.z = ${c.armZ};
              r.rotation.z = -${c.armZ};
            }
          }
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 500));
    const img = await win.capturePage();
    fs.writeFileSync(`/tmp/test-seed-${c.name}.png`, img.toPNG());
  }

  // Also test Shizuku scaling
  await win.webContents.executeJavaScript(`switchAvatar('shizuku')`);
  await new Promise(r => setTimeout(r, 2000));

  const shizukuConfigs = [
    { name: 'shizuku_scale_0_18', scale: 0.18, y: 0.52 },
    { name: 'shizuku_scale_0_20', scale: 0.20, y: 0.52 },
    { name: 'shizuku_scale_0_22', scale: 0.22, y: 0.50 }
  ];

  for (const sc of shizukuConfigs) {
    await win.webContents.executeJavaScript(`
      (() => {
        if (currentModel) {
          currentModel.scale.set(${sc.scale});
          currentModel.anchor.set(0.5, 0.5);
          currentModel.x = 260 * 0.5;
          currentModel.y = 540 * ${sc.y};
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 500));
    const img = await win.capturePage();
    fs.writeFileSync(`/tmp/test-shizuku-${sc.name}.png`, img.toPNG());
  }

  app.quit();
});
