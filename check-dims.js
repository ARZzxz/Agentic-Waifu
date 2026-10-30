const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'x11');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 260, height: 540, show: false });
  await win.loadURL('http://localhost:3000/desktop.html');
  await new Promise(r => setTimeout(r, 2000));
  await win.webContents.executeJavaScript(`switchAvatar('shizuku')`);
  await new Promise(r => setTimeout(r, 2000));

  const logInfo = await win.webContents.executeJavaScript(`
    (() => {
      const beforeScale = currentModel.scale.x;
      currentModel.scale.set(0.16);
      currentModel.x = 130;
      currentModel.y = 350;
      const afterScale = currentModel.scale.x;
      const bounds = currentModel.getBounds();
      return { beforeScale, afterScale, bounds };
    })()
  `);
  console.log('Scale test:', logInfo);
  app.quit();
});
