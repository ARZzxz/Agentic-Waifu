const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'x11');

app.whenReady().then(async () => {
  console.log('Testing Desktop Companion sizes...');
  const deskWin = new BrowserWindow({
    width: 260,
    height: 540,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  await deskWin.loadURL('http://localhost:3000/desktop.html');
  await new Promise(r => setTimeout(r, 2000));

  // 1. Shizuku in desktop
  console.log('Switching to Shizuku in desktop...');
  await deskWin.webContents.executeJavaScript(`switchAvatar('shizuku')`);
  await new Promise(r => setTimeout(r, 2500));
  let img = await deskWin.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/verified-desk-shizuku.png', img.toPNG());

  // 2. Seed-san in desktop
  console.log('Switching to Seed-san in desktop...');
  await deskWin.webContents.executeJavaScript(`switchAvatar('seed-san')`);
  await new Promise(r => setTimeout(r, 2500));
  img = await deskWin.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/verified-desk-seed.png', img.toPNG());

  // 3. Haru in desktop
  console.log('Switching to Haru in desktop...');
  await deskWin.webContents.executeJavaScript(`switchAvatar('haru')`);
  await new Promise(r => setTimeout(r, 2500));
  img = await deskWin.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/verified-desk-haru.png', img.toPNG());

  // Test Browser (index.html)
  console.log('\nTesting Browser (index.html) sizes...');
  const browserWin = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false
  });

  await browserWin.loadURL('http://localhost:3000/index.html');
  await new Promise(r => setTimeout(r, 2000));

  // 4. Shizuku in browser
  console.log('Switching to Shizuku in browser...');
  await browserWin.webContents.executeJavaScript(`switchAvatar('models/shizuku/shizuku.model.json')`);
  await new Promise(r => setTimeout(r, 2500));
  img = await browserWin.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/verified-browser-shizuku.png', img.toPNG());

  // 5. Seed-san in browser
  console.log('Switching to Seed-san in browser...');
  await browserWin.webContents.executeJavaScript(`switchAvatar('models/vrm/seed-san.vrm')`);
  await new Promise(r => setTimeout(r, 2500));
  img = await browserWin.capturePage();
  fs.writeFileSync('/home/user/.gemini/antigravity-cli/brain/de916e98-acb0-45d9-84b0-7650ef9c5681/verified-browser-seed.png', img.toPNG());

  console.log('All verification screenshots captured successfully!');
  app.quit();
});
