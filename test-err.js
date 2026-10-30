const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform', 'x11');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 260, height: 540, show: false });
  win.webContents.on('console-message', (e, level, msg) => console.log('RENDERER:', msg));

  await win.loadURL('http://localhost:3000/desktop.html');
  await new Promise(r => setTimeout(r, 2000));
  await win.webContents.executeJavaScript(`switchAvatar('shizuku')`);
  await new Promise(r => setTimeout(r, 3000));
  app.quit();
});
