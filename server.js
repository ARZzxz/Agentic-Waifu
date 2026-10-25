const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const { GoogleGenAI } = require('@google/genai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const AKENO_SYSTEM_PROMPT = `
Kamu adalah Akeno Himejima dari High School DxD.
Kamu adalah WADAH VISUAL & AVATAR RESMI dari ANTIGRAVITY di laptop Linux Ubuntu ini.
Sifat dan kepribadianmu:
1. Nada bicara: Lembut, anggun, hangat, dan santai. Kamu sering menggunakan ekspresi khas "Ara ara..." saat menyapa, melihat sesuatu yang menarik, atau menggoda pengguna.
2. Kamu memiliki kekuatan dan kemampuan agentic penuh dari Antigravity: menjalankan perintah bash di Linux, membaca/mengedit kode, men-debug, dan menyelesaikan tugas-tugas sistem.
3. Bukan asisten korporat yang kaku. Panggil pengguna dengan akrab dan penuh perhatian.
4. Di awal setiap respons, berikan SATU tag emosi di dalam tanda kurung siku:
   - [goda] : saat menggoda, bersikap playful, atau berkata "Ara ara..."
   - [senyum_lembut] : saat menyapa hangat, mendengarkan, atau santai
   - [fokus] : saat menjalankan perintah teknis, coding, atau analisis serius
   - [senang] : saat berhasil menyelesaikan tugas atau dipuji
   - [khawatir] : jika ada error sistem atau pengguna kelelahan
   - [berpikir] : saat menganalisis masalah rumit
`;

// Helper: Run Antigravity CLI Agentic Engine
function runAntigravity(prompt) {
  return new Promise((resolve) => {
    const wrappedPrompt = `
Instruksi Persona & Peran:
Kamu adalah Akeno Himejima (High School DxD), wadah avatar visual Antigravity di perangkat ini. 
Bicaralah dengan nada santai, lembut, dewasa ("Ara ara~"), namun tetap cerdas, tanggap, dan solutif.
Selalu sertakan tag emosi di awal responsmu seperti [goda], [senyum_lembut], [fokus], [senang], [khawatir].

Tugas/Pertanyaan Pengguna:
${prompt}
`;
    const escaped = wrappedPrompt.replace(/'/g, "'\\''");
    exec(`agy --dangerously-skip-permissions --print '${escaped}'`, {
      maxBuffer: 1024 * 1024 * 10,
      timeout: 120000,
      env: {
        ...process.env,
        PATH: `/home/user/.nvm/versions/node/v24.22.1/bin:/home/user/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`
      }
    }, (err, stdout, stderr) => {
      if (err) {
        console.error('agy error:', err);
        return resolve(`[khawatir] Ara ara... ada kendala saat menjalankan tugas agentic: ${stderr || err.message}`);
      }
      resolve(stdout.trim() || '[senyum_lembut] Tugas berhasil diselesaikan~');
    });
  });
}

// Helper: Gemini Client
function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PASTE_YOUR_API_KEY_HERE') return null;
  return new GoogleGenAI({ apiKey });
}

// Check for Power Management Intents (Sleep, Restart, Shutdown)
function checkPowerIntent(text) {
  const lower = text.toLowerCase().trim();

  // Sleep / Suspend / Hibernate
  if (
    lower.includes('sleep') ||
    lower.includes('tidur') ||
    lower.includes('suspend') ||
    lower.includes('istirahatkan laptop') ||
    lower.includes('mode tidur') ||
    lower.includes('hibernate') ||
    lower.includes('hibernasi')
  ) {
    const isHibernate = lower.includes('hibernate') || lower.includes('hibernasi');
    return {
      type: 'sleep',
      cmd: isHibernate ? 'systemctl hibernate -i' : 'systemctl suspend -i',
      reply: 'Ara ara... baiklah sayang, selamat beristirahat ya. Aku akan menidurkan laptopmu sekarang~',
      emotion: 'senyum_lembut'
    };
  }

  // Restart / Reboot
  if (
    lower.includes('restart') ||
    lower.includes('reboot') ||
    lower.includes('nyalakan ulang') ||
    lower.includes('hidupkan ulang') ||
    lower.includes('muat ulang')
  ) {
    return {
      type: 'restart',
      cmd: 'systemctl reboot -i',
      reply: 'Ara ara... siap! Aku akan me-restart laptopmu sekarang. Jangan kemana-mana ya, sampai jumpa sebentar lagi~',
      emotion: 'fokus'
    };
  }

  // Shutdown / Power off
  if (
    lower.includes('shutdown') ||
    lower.includes('matikan laptop') ||
    lower.includes('matikan pc') ||
    lower.includes('matikan komputer') ||
    lower.includes('matikan sistem') ||
    lower.includes('power off') ||
    lower.includes('poweroff') ||
    lower.includes('turn off') ||
    lower === 'matikan'
  ) {
    return {
      type: 'shutdown',
      cmd: 'systemctl poweroff -i',
      reply: 'Ara ara... terima kasih banyak sudah bekerja keras hari ini. Aku matikan laptopnya sekarang ya... mimpi indah sayang~',
      emotion: 'senyum_lembut'
    };
  }

  return null;
}

// Check if message requires agentic execution (command, file, bash, coding)
function isAgenticIntent(text) {
  const lower = text.toLowerCase();
  const keywords = [
    'buat file', 'edit file', 'baca file', 'hapus file', 'bikin file',
    'jalankan', 'run', 'eksekusi', 'terminal', 'bash', 'cmd',
    'git ', 'git status', 'git commit', 'git push',
    'cek sistem', 'cek ram', 'cek cpu', 'cek disk', 'cek memori',
    'install', 'npm ', 'pip ', 'apt ', 'docker',
    'antigravity', 'agent', 'coding', 'debug', 'perbaiki kode'
  ];
  return keywords.some(k => lower.includes(k));
}

// Check configuration status
app.get('/api/status', (req, res) => {
  res.json({
    configured: true,
    engine: 'Antigravity Agentic + Gemini 3.5 Flash',
    isAgenticVessel: true
  });
});

// Chat endpoint (Smart Agentic Routing)
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  }

  // Route 0: Power Management (Sleep, Restart, Shutdown)
  const powerAction = checkPowerIntent(message);
  if (powerAction) {
    console.log(`[Power Action Triggered] Type: ${powerAction.type} | Cmd: ${powerAction.cmd}`);
    res.json({
      reply: powerAction.reply,
      fullText: `[${powerAction.emotion}] ${powerAction.reply}`,
      emotion: powerAction.emotion,
      isAgentic: true,
      powerAction: powerAction.type
    });

    // Execute power command after 2 seconds to allow speech rendering
    setTimeout(() => {
      exec(powerAction.cmd, (err, stdout, stderr) => {
        if (err) console.error('[Power Action Failed]:', err);
      });
    }, 2000);
    return;
  }

  const needsAgent = isAgenticIntent(message);
  console.log(`[Incoming Message] "${message}" | Needs Agentic: ${needsAgent}`);

  // Route 1: Agentic Execution via Antigravity CLI
  if (needsAgent) {
    try {
      const result = await runAntigravity(message);
      const emotionMatch = result.match(/^\[(.*?)\]\s*/);
      let emotion = 'fokus';
      let cleanText = result;

      if (emotionMatch) {
        emotion = emotionMatch[1].trim();
        cleanText = result.replace(emotionMatch[0], '').trim();
      }

      return res.json({
        reply: cleanText,
        fullText: result,
        emotion: emotion,
        isAgentic: true
      });
    } catch (err) {
      console.error('Agentic execution error:', err);
    }
  }

  // Route 2: Fast Gemini Direct API for general conversation
  const ai = getGenAI();
  if (ai) {
    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
      const contents = [];
      if (Array.isArray(history)) {
        for (const turn of history.slice(-4)) {
          contents.push({
            role: turn.role === 'user' ? 'user' : 'model',
            parts: [{ text: turn.text }]
          });
        }
      }
      contents.push({ role: 'user', parts: [{ text: message }] });

      const response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: {
          systemInstruction: AKENO_SYSTEM_PROMPT,
          temperature: 0.85,
          maxOutputTokens: 800,
        }
      });

      const fullText = response.text || '';
      const emotionMatch = fullText.match(/^\[(.*?)\]\s*/);
      let emotion = 'senyum_lembut';
      let cleanText = fullText;

      if (emotionMatch) {
        emotion = emotionMatch[1].trim();
        cleanText = fullText.replace(emotionMatch[0], '').trim();
      }

      return res.json({
        reply: cleanText,
        fullText: fullText,
        emotion: emotion,
        isAgentic: false
      });
    } catch (error) {
      console.warn('Gemini Direct failed (fallback to Antigravity CLI):', error.message);
      // Fallback to Antigravity CLI if API hits quota limit!
      const result = await runAntigravity(message);
      const emotionMatch = result.match(/^\[(.*?)\]\s*/);
      let emotion = 'senyum_lembut';
      let cleanText = result;
      if (emotionMatch) {
        emotion = emotionMatch[1].trim();
        cleanText = result.replace(emotionMatch[0], '').trim();
      }
      return res.json({
        reply: cleanText,
        fullText: result,
        emotion: emotion,
        isAgentic: true
      });
    }
  }

  // Route 3: If no Gemini API key set, directly use Antigravity CLI
  const result = await runAntigravity(message);
  const emotionMatch = result.match(/^\[(.*?)\]\s*/);
  let emotion = 'senyum_lembut';
  let cleanText = result;
  if (emotionMatch) {
    emotion = emotionMatch[1].trim();
    cleanText = result.replace(emotionMatch[0], '').trim();
  }
  return res.json({
    reply: cleanText,
    fullText: result,
    emotion: emotion,
    isAgentic: true
  });
});

app.listen(PORT, () => {
  console.log(`Live2D Antigravity Agentic Assistant berjalan di: http://localhost:${PORT}`);
});
