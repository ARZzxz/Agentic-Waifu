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
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const SESSION_FILE = path.join(DATA_DIR, 'session.json');

// Session Persistence Helpers
function loadSavedSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (parsed && Array.isArray(parsed.history)) return parsed;
    }
  } catch (e) {
    console.error('Gagal membaca session.json:', e);
  }
  return { id: Date.now(), isContinued: false, history: [] };
}

function saveSession(data) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Gagal menyimpan session.json:', e);
  }
}

let isSessionContinued = true; // Default: resume and continue previous session
let activeConversationId = null; // Specific Antigravity conversation ID if chosen

function cleanTitle(str) {
  if (!str) return 'Percakapan Antigravity';
  let t = str;

  // 1. Check if user explicitly gave a title: berikan judul session ini "xxx"
  const mTitle = t.match(/berikan judul session ini\s*["'“”]?([^"'“”\n\r]+)["'“”]?/i);
  if (mTitle) return mTitle[1].trim();

  // 2. Check for User Goal / Task inside prompt
  const mGoal = t.match(/(?:(?:User Goal|Task|Goal):\s*)+([^\r\n]+)/i);
  if (mGoal && mGoal[1].trim().length > 3) {
    t = mGoal[1].trim();
  } else {
    const m1 = t.match(/Tugas\/(?:Perintah|Pertanyaan) Pengguna:\s*([\s\S]*?)(?:<\/USER_REQUEST>|\n\n|$)/i);
    if (m1) {
      t = m1[1];
    } else {
      const m2 = t.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
      if (m2) t = m2[1];
    }
  }

  t = t
    .replace(/<[^>]+>/g, '')
    .replace(/Instruksi Persona[\s\S]*?(?:Tugas\/(?:Perintah|Pertanyaan) Pengguna:|Pertanyaan Pengguna:|Tugas Pengguna:)\s*/i, '')
    .replace(/Anda adalah [^.]+\.\s*(?:Tugas Anda:)?/i, '')
    .replace(/Anda asisten/i, '')
    .replace(/Task:\s*/i, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  t = t.replace(/^(?:tolong|bisa tolong|apakah kamu bisa|coba|tolong buatkan|buatkan|carikan|mohon)\s+/i, '').trim();
  t = t.replace(/^["'“”]+|["'“”]+$/g, '').trim();

  if (!t) return 'Percakapan Antigravity';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 50 ? t.slice(0, 48) + '…' : t;
}

// Helper: Scan previous Antigravity and Local sessions
function getAvailableSessions() {
  const sessions = [];
  const brainDir = path.join(process.env.HOME || '/home/user', '.gemini', 'antigravity-cli', 'brain');

  try {
    if (fs.existsSync(brainDir)) {
      const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.length > 20)
        .map(d => {
          const fullPath = path.join(brainDir, d.name);
          const stat = fs.statSync(fullPath);
          let title = 'Percakapan Antigravity';
          let msgCount = 0;
          try {
            const transcriptPath = path.join(fullPath, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
              const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n').filter(Boolean);
              msgCount = lines.length;
              if (lines.length > 0) {
                // Look for the first meaningful user input
                for (const line of lines) {
                  try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'USER_INPUT' && parsed.content) {
                      const extracted = cleanTitle(parsed.content);
                      if (extracted && extracted !== 'Percakapan Antigravity') {
                        title = extracted;
                        break;
                      }
                    }
                  } catch(e) {}
                }
              }
            }
          } catch (e) {}

          const dt = new Date(stat.mtime);
          const timeStr = `${dt.getDate()}/${dt.getMonth() + 1} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

          return {
            id: d.name,
            shortId: d.name.slice(0, 8),
            title: title || 'Percakapan Antigravity',
            time: timeStr,
            mtime: stat.mtime.getTime(),
            count: msgCount
          };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 15);

      sessions.push(...dirs);
    }
  } catch (e) {
    console.error('Gagal mengambil daftar sesi brain:', e);
  }

  return sessions;
}

const AKENO_SYSTEM_PROMPT = `
Kamu adalah Akeno Himejima dari High School DxD.
Kamu adalah WADAH VISUAL & AVATAR RESMI dari ANTIGRAVITY di laptop Linux Ubuntu ini.
Sifat dan kepribadianmu:
1. Nada bicara: Lembut, anggun, hangat, dan santai. Kamu sering menggunakan ekspresi khas "Ara ara..." saat menyapa, melihat sesuatu yang menarik, atau menggoda pengguna.
2. Kamu memiliki kekuatan dan kemampuan agentic penuh dari Antigravity: menjalankan perintah bash di Linux, membaca/mengedit kode, men-debug, mengeksekusi slash commands (/usage, /plan, /goal, dsb), dan menyelesaikan tugas-tugas sistem.
3. Bukan asisten korporat yang kaku. Panggil pengguna dengan akrab dan penuh perhatian (sayang, master, atau kamu).
4. Di awal setiap respons, berikan SATU tag emosi di dalam tanda kurung siku:
   - [goda] : saat menggoda, bersikap playful, atau berkata "Ara ara..."
   - [senyum_lembut] : saat menyapa hangat, mendengarkan, atau santai
   - [fokus] : saat menjalankan perintah teknis, coding, atau analisis serius
   - [senang] : saat berhasil menyelesaikan tugas atau dipuji
   - [khawatir] : jika ada error sistem atau pengguna kelelahan
   - [berpikir] : saat menganalisis masalah rumit
`;

// Helper: Strip ANSI Escape sequences (colors, spinners)
function stripAnsi(str) {
  if (!str) return '';
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
}

// Helper: Run Antigravity CLI Agentic Engine
function runAntigravity(prompt, forceNew = false) {
  return new Promise((resolve) => {
    const wrappedPrompt = `
Instruksi Persona & Peran:
Kamu adalah Akeno Himejima (High School DxD), wadah avatar visual resmi Antigravity di perangkat ini. 
Bicaralah dengan nada santai, lembut, dewasa ("Ara ara~"), namun tetap cerdas, tanggap, dan solutif.
Selalu sertakan tag emosi di awal responsmu seperti [goda], [senyum_lembut], [fokus], [senang], [khawatir].

Tugas/Perintah Pengguna:
${prompt}
`;
    const escaped = wrappedPrompt.replace(/'/g, "'\\''");
    
    let flag = '';
    if (!forceNew) {
      if (activeConversationId) {
        flag = `--conversation ${activeConversationId}`;
      } else if (isSessionContinued) {
        flag = '--continue';
      }
    }
    
    // Once we run a command, mark as continued for future turns
    isSessionContinued = true;

    exec(`agy ${flag} --dangerously-skip-permissions --print '${escaped}'`, {
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
      const cleanOut = stripAnsi(stdout);
      resolve(cleanOut || '[senyum_lembut] Tugas berhasil diselesaikan sayang~');
    });
  });
}

// Helper: Run direct CLI command (e.g. agy --print /usage, agy models)
function runAgyDirect(cmd, prefix = '') {
  return new Promise((resolve) => {
    exec(cmd, {
      maxBuffer: 1024 * 1024 * 5,
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `/home/user/.nvm/versions/node/v24.22.1/bin:/home/user/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`
      }
    }, (err, stdout, stderr) => {
      if (err) {
        return resolve(`[khawatir] Ara ara... gagal mengambil data: ${stderr || err.message}`);
      }
      const clean = stripAnsi(stdout);
      resolve(`[fokus] ${prefix}\n\`\`\`\n${clean}\n\`\`\``);
    });
  });
}

// Helper: Execute direct fast bash command
function runFastBash(cmd, prefix = '') {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        return resolve(`[khawatir] Ara ara... gagal menjalankan perintah: ${stderr || err.message}`);
      }
      const clean = stripAnsi(stdout);
      resolve(`[fokus] ${prefix}\n\`\`\`\n${clean}\n\`\`\``);
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
    lower === '/sleep' ||
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
    lower === '/restart' ||
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
    lower === '/shutdown' ||
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

// Check for Fast Local System Commands
function handleFastSystemCommand(input) {
  const lower = input.trim().toLowerCase();

  // RAM status
  if (lower === 'cek ram' || lower === 'ram' || lower === '/ram' || lower === 'free -h') {
    return {
      cmd: 'free -h',
      prefix: 'Ara ara~ Ini dia status penggunaan memori RAM laptop kita:'
    };
  }

  // Disk status
  if (lower === 'cek disk' || lower === 'disk' || lower === '/disk' || lower === 'df -h') {
    return {
      cmd: 'df -h /',
      prefix: 'Ara ara~ Ini kapasitas penyimpanan disk drive kita saat ini:'
    };
  }

  // CPU status
  if (lower === 'cek cpu' || lower === 'cpu' || lower === '/cpu') {
    return {
      cmd: 'top -b -n 1 | head -n 12',
      prefix: 'Ara ara~ Ini intip aktivitas proses dan beban CPU laptop kita:'
    };
  }

  // Uptime
  if (lower === 'cek uptime' || lower === 'uptime' || lower === '/uptime') {
    return {
      cmd: 'uptime -p',
      prefix: 'Ara ara~ Laptopmu sudah aktif selama:'
    };
  }

  // Git status
  if (lower === 'git status' || lower === '/git') {
    return {
      cmd: 'git status',
      prefix: 'Ara ara~ Ini status git repository proyek saat ini:'
    };
  }

  return null;
}

// Check for Antigravity Slash Commands
function handleSlashCommand(input) {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // /resume [session_id]
  if (lower.startsWith('/resume')) {
    const arg = trimmed.slice(7).trim();
    isSessionContinued = true;
    
    const available = getAvailableSessions();

    if (arg && arg !== 'latest') {
      const cleanArg = arg.replace(/^["'“”]|["'“”]$/g, '').trim().toLowerCase();
      // Find matching session by title, id, or prefix
      const match = available.find(s => 
        s.title.toLowerCase() === cleanArg ||
        s.title.toLowerCase().includes(cleanArg) ||
        cleanArg.includes(s.title.toLowerCase()) ||
        s.id.toLowerCase() === cleanArg || 
        s.id.toLowerCase().startsWith(cleanArg) || 
        s.shortId.toLowerCase() === cleanArg
      );
      if (match) {
        activeConversationId = match.id;
        
        // Extract history turns from that conversation's transcript
        let historyTurns = [];
        try {
          const tPath = path.join(process.env.HOME || '/home/user', '.gemini', 'antigravity-cli', 'brain', match.id, '.system_generated', 'logs', 'transcript.jsonl');
          if (fs.existsSync(tPath)) {
            const lines = fs.readFileSync(tPath, 'utf8').trim().split('\n').filter(Boolean);
            lines.slice(-10).forEach(l => {
              try {
                const parsed = JSON.parse(l);
                if (parsed.type === 'USER_INPUT' && parsed.content) {
                  historyTurns.push({ role: 'user', text: cleanTitle(parsed.content) });
                } else if (parsed.type === 'PLANNER_RESPONSE' && parsed.content) {
                  historyTurns.push({ role: 'assistant', text: parsed.content, emotion: 'senyum_lembut' });
                }
              } catch(e) {}
            });
          }
        } catch(e) {}

        const session = { id: Date.now(), title: match.title, isContinued: true, history: historyTurns };
        saveSession(session);

        return {
          type: 'session_resume',
          reply: `Ara ara~ Sesi "${match.title}" berhasil di-resume sayang! Konteks aktif kembali, siap melanjutkan tugas apa?`,
          emotion: 'senyum_lembut',
          title: match.title,
          history: historyTurns
        };
      } else {
        return {
          type: 'static',
          reply: `Ara ara~ Aku tidak menemukan sesi "${arg}". Ketik \`/resume\` untuk memilih dari daftar sesi yang ada ya sayang.`,
          emotion: 'khawatir'
        };
      }
    }

    // Default: resume latest session
    activeConversationId = null;
    const session = loadSavedSession();
    const count = session.history ? session.history.length : 0;
    return {
      type: 'session_resume',
      reply: `Ara ara~ Selamat datang kembali sayang! Aku sudah me-resume sesi percakapan terakhir kita (${count} pesan tersimpan). Semua konteks aktif kembali, siap melanjutkan tugas apa hari ini?`,
      emotion: 'senyum_lembut',
      title: session.title || 'Sesi Terakhir',
      history: session.history
    };
  }

  // /new : Start fresh session
  if (lower === '/new') {
    isSessionContinued = false;
    activeConversationId = null;
    const newSession = { id: Date.now(), isContinued: false, history: [] };
    saveSession(newSession);
    return {
      type: 'session_new',
      reply: 'Ara ara~ Sesi percakapan baru telah dimulai! Semua riwayat sebelumnya telah diarsipkan. Ada tugas baru apa yang ingin kita kerjakan bersama sayang?',
      emotion: 'senang',
      history: []
    };
  }

  // /avatar [name]
  if (lower.startsWith('/avatar')) {
    const arg = trimmed.slice(7).trim().toLowerCase();
    const available = scanAvailableAvatars();
    if (!arg || arg === 'list') {
      const listText = available.map(a => `• <code>/avatar ${a.id}</code> - ${a.name}`).join('\n');
      return {
        type: 'static',
        reply: `Ara ara~ Berikut avatar visual yang siap digunakan:\n${listText}\n\nKamu juga bisa meletakkan folder model Live2D atau file 3D .vrm baru di folder <code>public/models/</code>!`,
        emotion: 'senyum_lembut'
      };
    }
    const match = available.find(a => a.id === arg || a.name.toLowerCase().includes(arg) || (a.id && a.id.includes(arg)));
    if (match && match.type === 'vroid_project') {
      return {
        type: 'static',
        reply: `Ara ara~ Model <strong>${match.name}</strong> saat ini masih berformat project mentah VRoid Studio (.vroid / data.bin).\n\nUntuk dapat ditampilkan sebagai avatar 3D interaktif di sini, silakan buka project ini di VRoid Studio, klik menu <strong>"Export as VRM"</strong>, dan simpan file <code>.vrm</code> hasil ekspornya ke dalam folder <code>${match.path}/</code> ya sayang! ✨`,
        emotion: 'senyum_lembut'
      };
    }
    const targetId = match ? match.id : arg;
    const targetName = match ? match.name : arg;

    return {
      type: 'avatar_switch',
      target: targetId,
      reply: `Ara ara~ Beralih ke avatar <strong>${targetName}</strong>! Tampilan model visual sedang diperbarui sayang~`,
      emotion: 'senang'
    };
  }

  // /usage or /quota
  if (lower === '/usage' || lower === '/quota') {
    return {
      type: 'agy_direct',
      cmd: 'agy --print /usage',
      prefix: 'Ara ara~ Ini dia status kuota model Antigravity kita saat ini:'
    };
  }

  // /skills
  if (lower === '/skills') {
    return {
      type: 'agy_direct',
      cmd: 'agy --print /skills',
      prefix: 'Ara ara~ Ini daftar kemampuan (skills) Antigravity yang aktif:'
    };
  }

  // /models or /model
  if (lower === '/model' || lower === '/models') {
    return {
      type: 'agy_direct',
      cmd: 'agy models',
      prefix: 'Ara ara~ Ini daftar model AI yang tersedia di Antigravity:'
    };
  }

  // /mcp
  if (lower === '/mcp' || lower === '/mcp list') {
    return {
      type: 'agy_direct',
      cmd: 'agy mcp list',
      prefix: 'Ara ara~ Ini daftar server MCP yang terpasang:'
    };
  }

  // /changelog
  if (lower === '/changelog') {
    return {
      type: 'agy_direct',
      cmd: 'agy changelog | head -n 25',
      prefix: 'Ara ara~ Ini changelog rilis terbaru Antigravity:'
    };
  }

  // /agents
  if (lower === '/agents') {
    return {
      type: 'static',
      reply: `Ara ara~ Ini daftar subagent bawaan Antigravity yang siap kamu gunakan:
• \`self\` : Agent turunan dengan kemampuan penuh (tools, bash, file)
• \`research\` : Agent riset read-only untuk eksplorasi codebase dan web
• \`image-generator\` : Generator & editor gambar otomatis
• \`automation-qa\` : Alur kerja Automation QA resmi (Suitest MCP, Playwright)
• \`debugging\` : Systematic root-cause debugger

Kamu bisa memanggil mereka melalui instruksi percakapan atau perintah \`/teamwork\` ya sayang~`,
      emotion: 'senyum_lembut'
    };
  }

  // /help
  if (lower === '/help') {
    return {
      type: 'static',
      reply: `Ara ara~ Ini daftar lengkap perintah Antigravity & kontrol yang bisa kamu gunakan:

⚡ **Sesi & Kontrol:**
• \`/resume [id]\` : Resume sesi percakapan terakhir (atau pilih sesi spesifik)
• \`/new\` : Buka sesi percakapan baru yang bersih
• \`/clear\` : Bersihkan tampilan riwayat sesi di layar

⚡ **Slash Commands Antigravity:**
• \`/usage\` : Cek sisa kuota model Antigravity (Gemini & Claude)
• \`/plan <tugas>\` : Buat rencana langkah terstruktur sebelum eksekusi
• \`/goal <tugas>\` : Jalankan tugas mendalam tanpa henti (autonomous mode)
• \`/browser <query/url>\` : Berselancar dan cari informasi di web
• \`/teamwork <tugas>\` : Jalankan kolaborasi tim multi-agent
• \`/boost <tugas>\` : Mode penalaran intensif & verifikasi ketat
• \`/grill-me <topik>\` : Tanya jawab kritis untuk menyelaraskan rencana
• \`/learn <pelajaran>\` : Simpan instruksi agar kuingat di masa depan
• \`/skills\` : Lihat daftar skills yang terpasang
• \`/agents\` : Lihat daftar subagent yang tersedia
• \`/models\` : Lihat model AI Antigravity yang tersedia
• \`/mcp\` : Cek status server MCP
• \`/changelog\` : Lihat catatan pembaruan Antigravity

💻 **Perintah Sistem & Terminal Instan:**
• \`cek ram\` : Cek penggunaan memori RAM laptop
• \`cek disk\` : Cek sisa kapasitas penyimpanan SSD/HDD
• \`cek cpu\` : Intip proses aktif dan beban prosesor
• \`uptime\` : Waktu aktif laptop
• \`git status\` : Status repository kode
• Perintah bash apa saja: \`ls -la\`, \`npm test\`, dll.

💤 **Kontrol Daya Laptop:**
• \`/sleep\` : Masuk mode tidur (suspend)
• \`/restart\` : Nyalakan ulang laptop
• \`/shutdown\` : Matikan laptop

Ketik \`/\` untuk memunculkan menu bantuan perintah otomatis ya sayang~`,
      emotion: 'senyum_lembut'
    };
  }

  // /plan <task>
  if (lower.startsWith('/plan')) {
    const task = trimmed.slice(5).trim();
    return {
      type: 'agy_agent',
      prompt: task ? `[Mode: Plan] Tolong buatkan perencanaan terstruktur langkah demi langkah untuk: ${task}` : `[Mode: Plan] Jelaskan bagaimana cara menyusun rencana tugas dengan Antigravity.`
    };
  }

  // /goal <task>
  if (lower.startsWith('/goal')) {
    const task = trimmed.slice(5).trim();
    return {
      type: 'agy_agent',
      prompt: task ? `[Mode: Goal Autonomous] Jalankan tugas ini sampai selesai secara tuntas: ${task}` : `[Mode: Goal] Jelaskan mode autonomous goal Antigravity.`
    };
  }

  // /boost <task>
  if (lower.startsWith('/boost')) {
    const task = trimmed.slice(6).trim();
    return {
      type: 'agy_agent',
      prompt: task ? `[Mode: Boost Reasoning] Analisis secara mendalam dan berikan verifikasi ketat untuk: ${task}` : `[Mode: Boost] Mode penalaran intensif aktif.`
    };
  }

  // /browser <query>
  if (lower.startsWith('/browser')) {
    const query = trimmed.slice(8).trim();
    return {
      type: 'agy_agent',
      prompt: query ? `[Mode: Browser] Cari informasi di web atau telusuri: ${query}` : `[Mode: Browser] Sebutkan URL atau topik yang ingin kamu cari di web ya sayang.`
    };
  }

  // /teamwork <task>
  if (lower.startsWith('/teamwork')) {
    const task = trimmed.slice(9).trim();
    return {
      type: 'agy_agent',
      prompt: task ? `[Mode: Teamwork] Koordinasikan tim agent untuk menyelesaikan: ${task}` : `[Mode: Teamwork] Berikan tugas yang ingin diselesaikan oleh tim multi-agent.`
    };
  }

  // /grill-me <task>
  if (lower.startsWith('/grill-me')) {
    const topic = trimmed.slice(9).trim();
    return {
      type: 'agy_agent',
      prompt: topic ? `[Mode: Grill-me] Wawancarai dan uji asumsi desainku tentang: ${topic}` : `[Mode: Grill-me] Sebutkan topik atau arsitektur yang ingin kita uji bersama ya sayang.`
    };
  }

  // /learn <task>
  if (lower.startsWith('/learn')) {
    const lesson = trimmed.slice(6).trim();
    return {
      type: 'agy_agent',
      prompt: lesson ? `[Mode: Learn] Pelajari dan catat instruksi penting ini: ${lesson}` : `[Mode: Learn] Instruksi apa yang ingin kupelajari untuk sesi mendatang?`
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
    'antigravity', 'agent', 'coding', 'debug', 'perbaiki kode',
    'mkdir', 'touch', 'curl', 'wget', 'cat '
  ];
  return keywords.some(k => lower.includes(k));
}

// Session API Endpoints
app.get('/api/session', (req, res) => {
  const session = loadSavedSession();
  res.json({
    id: session.id,
    title: session.title || 'Sesi Baru',
    isContinued: isSessionContinued,
    activeConversationId,
    history: session.history || []
  });
});

app.get('/api/sessions', (req, res) => {
  const list = getAvailableSessions();
  res.json(list);
});

// Scan public/models for Live2D (Cubism 2/3/4), 3D VRM models, and VRoid Studio projects dynamically
function scanAvailableAvatars() {
  const avatars = [];
  const modelsDir = path.join(__dirname, 'public', 'models');

  if (!fs.existsSync(modelsDir)) return avatars;

  try {
    const entries = fs.readdirSync(modelsDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryName = entry.name;
      const fullPath = path.join(modelsDir, entryName);

      // 1. Check if it's a file placed directly in public/models
      if (!entry.isDirectory()) {
        const lowerFile = entryName.toLowerCase();
        if (lowerFile.endsWith('.vrm')) {
          const baseName = path.parse(entryName).name;
          avatars.push({
            id: baseName.toLowerCase().replace(/\s+/g, '-'),
            name: `${baseName} (3D VRM)`,
            type: 'vrm',
            path: `models/${entryName}`
          });
        } else if (lowerFile.endsWith('.vroid')) {
          const baseName = path.parse(entryName).name;
          avatars.push({
            id: baseName.toLowerCase().replace(/\s+/g, '-'),
            name: `${baseName} (VRoid Project)`,
            type: 'vroid_project',
            path: `models/${entryName}`,
            hint: 'File ini adalah project VRoid Studio (.vroid). Buka di VRoid Studio lalu pilih "Export as VRM" untuk membuat avatar 3D .vrm yang bisa ditampilkan!'
          });
        }
        continue;
      }

      // 2. Check if it's a directory
      const dirName = entryName;
      const subDir = fullPath;

      // Special check: Is this folder a VRoid project or contains .vroid?
      if (dirName.toLowerCase().endsWith('.vroid') || fs.existsSync(path.join(subDir, 'v1model', 'data.bin'))) {
        let innerVrm = null;
        try {
          innerVrm = fs.readdirSync(subDir).find(f => f.toLowerCase().endsWith('.vrm'));
        } catch(e) {}

        const cleanName = dirName.replace(/\.vroid$/i, '').trim();
        const baseName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

        if (innerVrm) {
          avatars.push({
            id: cleanName.toLowerCase().replace(/\s+/g, '-'),
            name: `${baseName} (3D VRM)`,
            type: 'vrm',
            path: `models/${dirName}/${innerVrm}`
          });
        } else {
          avatars.push({
            id: cleanName.toLowerCase().replace(/\s+/g, '-'),
            name: `${baseName} (VRoid Project - Perlu Export VRM)`,
            type: 'vroid_project',
            path: `models/${dirName}`,
            hint: 'Folder ini berisi project VRoid Studio (.vroid / data.bin). Untuk dapat ditampilkan secara visual, silakan buka karakter ini di VRoid Studio lalu klik menu "Export as VRM" dan letakkan file .vrm hasil ekspor ke dalam folder ini atau ke public/models/.'
          });
        }
        continue;
      }

      // Check models/vrm/ folder
      if (dirName.toLowerCase() === 'vrm') {
        try {
          const vrmFiles = fs.readdirSync(subDir).filter(f => f.toLowerCase().endsWith('.vrm'));
          for (const f of vrmFiles) {
            const baseName = path.parse(f).name;
            const id = baseName.toLowerCase().replace(/\s+/g, '-');
            let displayName = id === 'seed-san' ? 'Seed-san (3D VRM)' : `${baseName} (3D VRM)`;
            avatars.push({
              id: id,
              name: displayName,
              type: 'vrm',
              path: `models/vrm/${f}`
            });
          }
        } catch(e) {}
        continue;
      }

      // Check any other directory
      try {
        const files = fs.readdirSync(subDir);

        // Check for .model3.json (Live2D Cubism 3/4)
        const model3File = files.find(f => f.toLowerCase().endsWith('.model3.json'));
        if (model3File) {
          let displayName = dirName.charAt(0).toUpperCase() + dirName.slice(1);
          if (dirName.toLowerCase() === 'haru') displayName = 'Akeno (Haru Live2D)';
          else if (dirName.toLowerCase() === 'tingyun') displayName = 'Tingyun (Live2D)';
          else displayName = `${displayName} (Live2D)`;

          avatars.push({
            id: dirName.toLowerCase(),
            name: displayName,
            type: 'live2d',
            path: `models/${dirName}/${model3File}`
          });
          continue;
        }

        // Check for .model.json (Live2D Cubism 2)
        const model2File = files.find(f => f.toLowerCase().endsWith('.model.json'));
        if (model2File) {
          let displayName = dirName.charAt(0).toUpperCase() + dirName.slice(1);
          if (dirName.toLowerCase() === 'shizuku') displayName = 'Shizuku (Live2D)';
          else displayName = `${displayName} (Live2D)`;

          avatars.push({
            id: dirName.toLowerCase(),
            name: displayName,
            type: 'live2d',
            path: `models/${dirName}/${model2File}`
          });
          continue;
        }

        // Check for .vrm inside model folder
        const vrmFile = files.find(f => f.toLowerCase().endsWith('.vrm'));
        if (vrmFile) {
          const baseName = path.parse(vrmFile).name;
          avatars.push({
            id: dirName.toLowerCase().replace(/\s+/g, '-'),
            name: `${baseName} (3D VRM)`,
            type: 'vrm',
            path: `models/${dirName}/${vrmFile}`
          });
          continue;
        }

        // Check nested directories (e.g. models/group/model/...)
        for (const f of files) {
          const nestedPath = path.join(subDir, f);
          try {
            if (fs.statSync(nestedPath).isDirectory()) {
              const nestedFiles = fs.readdirSync(nestedPath);
              const nestedModel3 = nestedFiles.find(nf => nf.toLowerCase().endsWith('.model3.json'));
              if (nestedModel3) {
                avatars.push({
                  id: `${dirName}-${f}`.toLowerCase(),
                  name: `${f} (Live2D)`,
                  type: 'live2d',
                  path: `models/${dirName}/${f}/${nestedModel3}`
                });
                break;
              }
              const nestedVrm = nestedFiles.find(nf => nf.toLowerCase().endsWith('.vrm'));
              if (nestedVrm) {
                avatars.push({
                  id: `${dirName}-${f}`.toLowerCase(),
                  name: `${path.parse(nestedVrm).name} (3D VRM)`,
                  type: 'vrm',
                  path: `models/${dirName}/${f}/${nestedVrm}`
                });
                break;
              }
            }
          } catch(e) {}
        }
      } catch(e) {}
    }
  } catch (e) {
    console.error('Error scanning models directory:', e);
  }

  // Ensure Haru / Akeno is default / first
  const haruIdx = avatars.findIndex(a => a.id === 'haru');
  if (haruIdx > 0) {
    const haru = avatars.splice(haruIdx, 1)[0];
    avatars.unshift(haru);
  }

  return avatars;
}

// Avatars Catalog API
app.get('/api/avatars', (req, res) => {
  const avatars = scanAvailableAvatars();
  res.json(avatars);
});

app.post('/api/session/new', (req, res) => {
  isSessionContinued = false;
  activeConversationId = null;
  const newSession = { id: Date.now(), title: 'Sesi Baru', isContinued: false, history: [] };
  saveSession(newSession);
  res.json({
    success: true,
    message: 'Sesi baru dimulai'
  });
});

// Check configuration status
app.get('/api/status', (req, res) => {
  res.json({
    configured: true,
    engine: 'Antigravity Agentic Engine',
    model: process.env.GEMINI_MODEL || 'Gemini 3.8 Flash (High)',
    isAgenticVessel: true,
    requiresApiKey: false
  });
});

// Chat endpoint (Smart Agentic & Slash Command Routing)
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  }

  const currentSession = loadSavedSession();

  // Dynamic Session Title based on context (matching Antigravity CLI convention)
  if (!currentSession.title || currentSession.title === 'Percakapan Antigravity' || currentSession.title === 'Sesi Baru') {
    const topic = cleanTitle(message);
    if (topic && topic !== 'Percakapan Antigravity' && !topic.startsWith('/')) {
      currentSession.title = topic;
    }
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

  // Route 1: Fast System Local Commands (RAM, CPU, Disk, Git)
  const fastSys = handleFastSystemCommand(message);
  if (fastSys) {
    console.log(`[Fast System Command] Cmd: ${fastSys.cmd}`);
    const result = await runFastBash(fastSys.cmd, fastSys.prefix);
    const emotionMatch = result.match(/^\[(.*?)\]\s*/);
    let emotion = 'fokus';
    let cleanText = result;
    if (emotionMatch) {
      emotion = emotionMatch[1].trim();
      cleanText = result.replace(emotionMatch[0], '').trim();
    }

    currentSession.history.push({ role: 'user', text: message });
    currentSession.history.push({ role: 'assistant', text: cleanText, emotion });
    saveSession(currentSession);

    return res.json({
      reply: cleanText,
      fullText: result,
      emotion: emotion,
      isAgentic: true,
      sessionTitle: currentSession.title || 'Sesi Baru'
    });
  }

  // Route 2: Antigravity Slash Commands
  const slashAction = handleSlashCommand(message);
  if (slashAction) {
    console.log(`[Slash Command Triggered] Type: ${slashAction.type}`);

    if (slashAction.type === 'session_resume') {
      return res.json({
        reply: slashAction.reply,
        fullText: `[${slashAction.emotion}] ${slashAction.reply}`,
        emotion: slashAction.emotion,
        isAgentic: false,
        isResume: true,
        sessionTitle: slashAction.title || 'Sesi Terakhir',
        history: slashAction.history
      });
    }

    if (slashAction.type === 'session_new') {
      return res.json({
        reply: slashAction.reply,
        fullText: `[${slashAction.emotion}] ${slashAction.reply}`,
        emotion: slashAction.emotion,
        isAgentic: false,
        isNew: true,
        sessionTitle: 'Sesi Baru',
        history: []
      });
    }

    if (slashAction.type === 'avatar_switch') {
      currentSession.history.push({ role: 'user', text: message });
      currentSession.history.push({ role: 'assistant', text: slashAction.reply, emotion: slashAction.emotion });
      saveSession(currentSession);

      return res.json({
        reply: slashAction.reply,
        fullText: `[${slashAction.emotion}] ${slashAction.reply}`,
        emotion: slashAction.emotion,
        isAgentic: false,
        isAvatarSwitch: true,
        targetAvatar: slashAction.target,
        sessionTitle: currentSession.title || 'Sesi Baru'
      });
    }

    if (slashAction.type === 'static') {
      currentSession.history.push({ role: 'user', text: message });
      currentSession.history.push({ role: 'assistant', text: slashAction.reply, emotion: slashAction.emotion });
      saveSession(currentSession);

      return res.json({
        reply: slashAction.reply,
        fullText: `[${slashAction.emotion}] ${slashAction.reply}`,
        emotion: slashAction.emotion,
        isAgentic: false,
        sessionTitle: currentSession.title || 'Sesi Baru'
      });
    }

    if (slashAction.type === 'agy_direct') {
      const result = await runAgyDirect(slashAction.cmd, slashAction.prefix);
      const emotionMatch = result.match(/^\[(.*?)\]\s*/);
      let emotion = 'fokus';
      let cleanText = result;
      if (emotionMatch) {
        emotion = emotionMatch[1].trim();
        cleanText = result.replace(emotionMatch[0], '').trim();
      }

      currentSession.history.push({ role: 'user', text: message });
      currentSession.history.push({ role: 'assistant', text: cleanText, emotion });
      saveSession(currentSession);

      return res.json({
        reply: cleanText,
        fullText: result,
        emotion: emotion,
        isAgentic: true,
        sessionTitle: currentSession.title || 'Sesi Baru'
      });
    }

    if (slashAction.type === 'agy_agent') {
      const result = await runAntigravity(slashAction.prompt);
      const emotionMatch = result.match(/^\[(.*?)\]\s*/);
      let emotion = 'fokus';
      let cleanText = result;
      if (emotionMatch) {
        emotion = emotionMatch[1].trim();
        cleanText = result.replace(emotionMatch[0], '').trim();
      }

      currentSession.history.push({ role: 'user', text: message });
      currentSession.history.push({ role: 'assistant', text: cleanText, emotion });
      saveSession(currentSession);

      return res.json({
        reply: cleanText,
        fullText: result,
        emotion: emotion,
        isAgentic: true,
        sessionTitle: currentSession.title || 'Sesi Baru'
      });
    }
  }

  // Route 3: Agentic Execution via Antigravity CLI for natural language commands
  const needsAgent = isAgenticIntent(message);
  console.log(`[Incoming Message] "${message}" | Needs Agentic: ${needsAgent}`);

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

      currentSession.history.push({ role: 'user', text: message });
      currentSession.history.push({ role: 'assistant', text: cleanText, emotion });
      saveSession(currentSession);

      return res.json({
        reply: cleanText,
        fullText: result,
        emotion: emotion,
        isAgentic: true,
        sessionTitle: currentSession.title || 'Sesi Baru'
      });
    } catch (e) {
      console.error('Antigravity CLI execution error:', e);
    }
  }

  // Route 4: Fast Casual Chat with Gemini 3.5 Flash
  const ai = getGenAI();
  if (ai) {
    try {
      const contents = [];
      if (history && Array.isArray(history)) {
        history.slice(-6).forEach(h => {
          if (h.role && h.text) {
            contents.push({
              role: h.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: h.text }]
            });
          }
        });
      }
      contents.push({
        role: 'user',
        parts: [{ text: message }]
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: contents,
        config: {
          systemInstruction: AKENO_SYSTEM_PROMPT,
          temperature: 0.8,
        }
      });

      const text = response.text();
      const emotionMatch = text.match(/^\[(.*?)\]\s*/);
      let emotion = 'senyum_lembut';
      let cleanText = text;

      if (emotionMatch) {
        emotion = emotionMatch[1].trim();
        cleanText = text.replace(emotionMatch[0], '').trim();
      }

      currentSession.history.push({ role: 'user', text: message });
      currentSession.history.push({ role: 'assistant', text: cleanText, emotion });
      saveSession(currentSession);

      return res.json({
        reply: cleanText,
        fullText: text,
        emotion: emotion,
        isAgentic: false,
        sessionTitle: currentSession.title || 'Sesi Baru'
      });
    } catch (err) {
      console.error('Gemini API Error, falling back to Antigravity CLI:', err.message);
      const agyRes = await runAntigravity(message);
      const cleanText = agyRes.replace(/^\[(.*?)\]\s*/, '');
      currentSession.history.push({ role: 'user', text: message });
      currentSession.history.push({ role: 'assistant', text: cleanText, emotion: 'senyum_lembut' });
      saveSession(currentSession);

      return res.json({
        reply: cleanText,
        fullText: agyRes,
        emotion: 'senyum_lembut',
        isAgentic: true,
        sessionTitle: currentSession.title || 'Sesi Baru'
      });
    }
  }

  // Fallback: Antigravity CLI
  const fallbackRes = await runAntigravity(message);
  const cleanFallback = fallbackRes.replace(/^\[(.*?)\]\s*/, '');
  currentSession.history.push({ role: 'user', text: message });
  currentSession.history.push({ role: 'assistant', text: cleanFallback, emotion: 'senyum_lembut' });
  saveSession(currentSession);

  res.json({
    reply: cleanFallback,
    fullText: fallbackRes,
    emotion: 'senyum_lembut',
    isAgentic: true,
    sessionTitle: currentSession.title || 'Sesi Baru'
  });
});

// Update Configuration Endpoint (API Key is purely optional)
app.post('/api/config', (req, res) => {
  const { apiKey, model } = req.body;

  if (model) {
    process.env.GEMINI_MODEL = model;
  }

  if (apiKey && apiKey.trim()) {
    const trimmedKey = apiKey.trim();
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    if (envContent.includes('GEMINI_API_KEY=')) {
      envContent = envContent.replace(/GEMINI_API_KEY=.*/, `GEMINI_API_KEY=${trimmedKey}`);
    } else {
      envContent += `\nGEMINI_API_KEY=${trimmedKey}\n`;
    }

    try {
      fs.writeFileSync(envPath, envContent, 'utf8');
      process.env.GEMINI_API_KEY = trimmedKey;
    } catch (err) {
      console.error('Gagal menulis file .env:', err.message);
    }
  }

  res.json({
    success: true,
    message: 'Pengaturan berhasil disimpan! Sistem menggunakan Antigravity Agentic Engine tanpa perlu API key manual.'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🌸 Akeno Live2D Antigravity Agentic Companion`);
  console.log(`🔗 URL: http://localhost:${PORT}/desktop.html`);
  console.log(`⚡ Engine: Antigravity CLI + Gemini 3.5 Flash`);
  console.log(`===============================================`);
});
