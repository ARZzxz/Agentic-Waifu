const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'x11');

app.whenReady().then(async () => {
  // Test Desktop first
  const win = new BrowserWindow({
    width: 260,
    height: 540,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  await win.loadURL('http://localhost:3000/desktop.html');
  await new Promise(r => setTimeout(r, 2000));

  console.log('--- DESKTOP: SHIZUKU ---');
  await win.webContents.executeJavaScript(`switchAvatar('shizuku')`);
  await new Promise(r => setTimeout(r, 3000));
  const shizukuDesk = await win.webContents.executeJavaScript(`
    ({
      bounds: currentModel ? currentModel.getBounds() : null,
      internalModelType: currentModel ? (currentModel.internalModel ? currentModel.internalModel.constructor.name : null) : null,
      width: currentModel ? currentModel.width : null,
      height: currentModel ? currentModel.height : null,
      scaleX: currentModel ? currentModel.scale.x : null,
      scaleY: currentModel ? currentModel.scale.y : null,
      x: currentModel ? currentModel.x : null,
      y: currentModel ? currentModel.y : null
    })
  `);
  console.log('Shizuku in Desktop:', shizukuDesk);
  let img = await win.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/desktop-shizuku.png', img.toPNG());

  console.log('--- DESKTOP: HARU ---');
  await win.webContents.executeJavaScript(`switchAvatar('haru')`);
  await new Promise(r => setTimeout(r, 3000));
  const haruDesk = await win.webContents.executeJavaScript(`
    ({
      bounds: currentModel ? currentModel.getBounds() : null,
      width: currentModel ? currentModel.width : null,
      height: currentModel ? currentModel.height : null,
      scaleX: currentModel ? currentModel.scale.x : null,
      scaleY: currentModel ? currentModel.scale.y : null,
      x: currentModel ? currentModel.x : null,
      y: currentModel ? currentModel.y : null
    })
  `);
  console.log('Haru in Desktop:', haruDesk);
  img = await win.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/desktop-haru.png', img.toPNG());

  console.log('--- DESKTOP: SEED-SAN ---');
  await win.webContents.executeJavaScript(`switchAvatar('seed-san')`);
  await new Promise(r => setTimeout(r, 3000));
  const seedDesk = await win.webContents.executeJavaScript(`
    ({
      activeEngine,
      camPos: vrmCamera ? [vrmCamera.position.x, vrmCamera.position.y, vrmCamera.position.z] : null,
      camFov: vrmCamera ? vrmCamera.fov : null
    })
  `);
  console.log('Seed-san in Desktop:', seedDesk);

  // Test Browser (index.html)
  console.log('\n--- BROWSER: INDEX.HTML ---');
  const winBrowser = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false
  });
  await winBrowser.loadURL('http://localhost:3000/index.html');
  await new Promise(r => setTimeout(r, 2000));

  await winBrowser.webContents.executeJavaScript(`switchAvatar('models/shizuku/shizuku.model.json')`);
  await new Promise(r => setTimeout(r, 3000));
  const shizukuBrowser = await winBrowser.webContents.executeJavaScript(`
    ({
      bounds: currentModel ? currentModel.getBounds() : null,
      width: currentModel ? currentModel.width : null,
      height: currentModel ? currentModel.height : null,
      scaleX: currentModel ? currentModel.scale.x : null,
      scaleY: currentModel ? currentModel.scale.y : null
    })
  `);
  console.log('Shizuku in Browser:', shizukuBrowser);
  img = await winBrowser.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/browser-shizuku.png', img.toPNG());

  await winBrowser.webContents.executeJavaScript(`switchAvatar('models/vrm/seed-san.vrm')`);
  await new Promise(r => setTimeout(r, 3000));
  const seedBrowser = await winBrowser.webContents.executeJavaScript(`
    ({
      activeEngine,
      camPos: vrmCamera ? [vrmCamera.position.x, vrmCamera.position.y, vrmCamera.position.z] : null,
      camFov: vrmCamera ? vrmCamera.fov : null
    })
  `);
  console.log('Seed-san in Browser:', seedBrowser);
  img = await winBrowser.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/browser-seed.png', img.toPNG());

  app.quit();
});
