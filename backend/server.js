require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs-extra');
const { Rcon } = require('rcon-client');
const schedule = require('node-schedule');
const archiver = require('archiver');
const { initDatabase, getDb } = require('./database');
const { authenticate, requireRole, logActivity } = require('./auth');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const logRoutes = require('./routes/logs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

initDatabase();

app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
});
app.use('/api/', limiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/logs', logRoutes);

const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
const BACKUP_DIR = path.join(MC_SERVER_DIR, 'backups');
const PLUGINS_DIR = path.join(MC_SERVER_DIR, 'plugins');

let rcon = null;
let serverStatus = {
  online: false,
  players: [],
  tps: 20,
  memory: { used: 0, max: 0 },
  uptime: 0,
  version: process.env.VERSION || '1.21.5'
};

async function connectRcon() {
  try {
    rcon = await Rcon.connect({
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_RCON_PORT) || 25575,
      password: process.env.MC_RCON_PASSWORD || 'minecraft123'
    });
    console.log('RCON Connected');
    serverStatus.online = true;
    io.emit('serverStatus', serverStatus);
    
    rcon.on('end', () => {
      console.log('RCON Disconnected');
      serverStatus.online = false;
      io.emit('serverStatus', serverStatus);
      setTimeout(connectRcon, 5000);
    });
  } catch (err) {
    console.log('RCON Connection failed, retrying in 5s...');
    serverStatus.online = false;
    setTimeout(connectRcon, 5000);
  }
}

async function executeCommand(cmd) {
  if (!rcon) throw new Error('RCON not connected');
  const response = await rcon.send(cmd);
  return response;
}

app.get('/api/status', async (req, res) => {
  try {
    if (serverStatus.online) {
      const playersList = await executeCommand('list');
      const tpsResponse = await executeCommand('tps');
      
      const playersMatch = playersList.match(/There are (\d+) of a max of (\d+) players online:(.*)/);
      if (playersMatch) {
        serverStatus.players = playersMatch[3].trim() ? playersMatch[3].trim().split(', ') : [];
      }
      
      const tpsMatch = tpsResponse.match(/TPS from last 1m, 5m, 15m: \*?([\d.]+), \*?([\d.]+), \*?([\d.]+)/);
      if (tpsMatch) serverStatus.tps = parseFloat(tpsMatch[1]);
    }
    res.json(serverStatus);
  } catch (err) {
    res.json(serverStatus);
  }
});

app.get('/api/players', async (req, res) => {
  try {
    if (serverStatus.online) {
      const response = await executeCommand('list');
      const match = response.match(/There are (\d+) of a max of (\d+) players online:(.*)/);
      if (match) {
        const players = match[3].trim() ? match[3].trim().split(', ') : [];
        res.json({ online: players.length, max: parseInt(match[2]), players });
      } else {
        res.json({ online: 0, max: 20, players: [] });
      }
    } else {
      res.json({ online: 0, max: 20, players: [] });
    }
  } catch (err) {
    res.json({ online: 0, max: 20, players: [] });
  }
});

app.post('/api/command', authenticate, requireRole('owner', 'admin', 'moderator'), async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Command required' });
  
  try {
    const response = await executeCommand(command);
    logActivity(req.user.id, 'execute_command', command, req.ip);
    io.emit('consoleOutput', { type: 'command', command, response, user: req.user.username });
    res.json({ success: true, response });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/player/kick', authenticate, requireRole('owner', 'admin', 'moderator'), async (req, res) => {
  const { player, reason } = req.body;
  try {
    await executeCommand(`kick ${player} ${reason || 'Kicked by admin'}`);
    logActivity(req.user.id, 'kick_player', `Kicked ${player}: ${reason}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/player/ban', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { player, reason } = req.body;
  try {
    await executeCommand(`ban ${player} ${reason || 'Banned by admin'}`);
    logActivity(req.user.id, 'ban_player', `Banned ${player}: ${reason}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/player/pardon', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { player } = req.body;
  try {
    await executeCommand(`pardon ${player}`);
    logActivity(req.user.id, 'pardon_player', `Pardoned ${player}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/player/op', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { player } = req.body;
  try {
    await executeCommand(`op ${player}`);
    logActivity(req.user.id, 'op_player', `Opped ${player}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/player/deop', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { player } = req.body;
  try {
    await executeCommand(`deop ${player}`);
    logActivity(req.user.id, 'deop_player', `De-opped ${player}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/player/gamemode', authenticate, requireRole('owner', 'admin', 'moderator'), async (req, res) => {
  const { player, mode } = req.body;
  try {
    await executeCommand(`gamemode ${mode} ${player}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/whitelist', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const whitelistPath = path.join(MC_SERVER_DIR, 'whitelist.json');
    if (await fs.pathExists(whitelistPath)) {
      const data = await fs.readJson(whitelistPath);
      res.json(data);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/bans', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const bansPath = path.join(MC_SERVER_DIR, 'banned-players.json');
    if (await fs.pathExists(bansPath)) {
      const data = await fs.readJson(bansPath);
      res.json(data);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/ops', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const opsPath = path.join(MC_SERVER_DIR, 'ops.json');
    if (await fs.pathExists(opsPath)) {
      const data = await fs.readJson(opsPath);
      res.json(data);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/plugins', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await fs.ensureDir(PLUGINS_DIR);
    const files = await fs.readdir(PLUGINS_DIR);
    const plugins = files
      .filter(f => f.endsWith('.jar'))
      .map(f => ({
        name: f,
        size: fs.statSync(path.join(PLUGINS_DIR, f)).size,
        modified: fs.statSync(path.join(PLUGINS_DIR, f)).mtime
      }));
    res.json(plugins);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/config', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const configPath = path.join(MC_SERVER_DIR, 'server.properties');
    if (await fs.pathExists(configPath)) {
      const content = await fs.readFile(configPath, 'utf8');
      const config = {};
      content.split('\n').forEach(line => {
        if (line.trim() && !line.startsWith('#')) {
          const [key, value] = line.split('=');
          if (key && value !== undefined) {
            config[key.trim()] = value.trim();
          }
        }
      });
      res.json(config);
    } else {
      res.json({});
    }
  } catch (err) {
    res.json({});
  }
});

app.post('/api/config', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(MC_SERVER_DIR, 'server.properties');
    let content = '#Minecraft server properties\n';
    Object.entries(config).forEach(([key, value]) => {
      content += `${key}=${value}\n`;
    });
    await fs.writeFile(configPath, content);
    logActivity(req.user.id, 'update_config', 'Updated server.properties', req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/server/start', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await executeCommand('start');
    logActivity(req.user.id, 'server_start', 'Started server', req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/server/stop', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await executeCommand('stop');
    logActivity(req.user.id, 'server_stop', 'Stopped server', req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/server/restart', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await executeCommand('restart');
    logActivity(req.user.id, 'server_restart', 'Restarted server', req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/server/save-all', authenticate, requireRole('owner', 'admin', 'moderator'), async (req, res) => {
  try {
    await executeCommand('save-all');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/server/backup', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await fs.ensureDir(BACKUP_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.zip`);
    
    const output = fs.createWriteStream(backupPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.pipe(output);
    archive.directory(MC_SERVER_DIR, false, { ignore: ['backups', 'plugins'] });
    await archive.finalize();
    
    logActivity(req.user.id, 'backup', 'Created server backup', req.ip);
    res.json({ success: true, path: backupPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/backups', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await fs.ensureDir(BACKUP_DIR);
    const files = await fs.readdir(BACKUP_DIR);
    const backups = files
      .filter(f => f.endsWith('.zip'))
      .map(f => ({
        name: f,
        size: fs.statSync(path.join(BACKUP_DIR, f)).size,
        created: fs.statSync(path.join(BACKUP_DIR, f)).birthtime
      }))
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(backups);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/worlds', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const worlds = [];
    const items = await fs.readdir(MC_SERVER_DIR);
    for (const item of items) {
      const itemPath = path.join(MC_SERVER_DIR, item);
      const stat = await fs.stat(itemPath);
      if (stat.isDirectory() && await fs.pathExists(path.join(itemPath, 'level.dat'))) {
        worlds.push({
          name: item,
          size: await getDirSize(itemPath),
          lastModified: stat.mtime
        });
      }
    }
    res.json(worlds);
  } catch (err) {
    res.json([]);
  }
});

async function getDirSize(dir) {
  let size = 0;
  const files = await fs.readdir(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      size += await getDirSize(filePath);
    } else {
      size += stat.size;
    }
  }
  return size;
}

app.get('/api/server/version', authenticate, (req, res) => {
  res.json({ 
    current: process.env.VERSION || '1.21.5',
    type: process.env.TYPE || 'PAPER'
  });
});

app.get('/api/server/versions', authenticate, async (req, res) => {
  try {
    const https = require('https');
    const url = 'https://papermc.io/api/v2/projects/paper';
    
    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          res.json((json.versions || []).reverse());
        } catch (e) {
          res.json(['1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.19.4']);
        }
      });
    }).on('error', () => {
      res.json(['1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.19.4']);
    });
  } catch (err) {
    res.json(['1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1']);
  }
});

app.get('/api/server/types', authenticate, (req, res) => {
  res.json([
    { id: 'PAPER', name: 'Paper', description: 'بهینه و سریع' },
    { id: 'SPIGOT', name: 'Spigot', description: 'پایدار و محبوب' },
    { id: 'BUKKIT', name: 'Bukkit', description: 'کلاسیک' },
    { id: 'FABRIC', name: 'Fabric', description: 'مدرن و سبک' },
    { id: 'FORGE', name: 'Forge', description: 'برای مادها' },
    { id: 'VANILLA', name: 'Vanilla', description: 'اصلی ماینکرفت' },
    { id: 'PURPUR', name: 'Purpur', description: 'بهینه‌ترین' }
  ]);
});

app.get('/api/schedules', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const jobs = [];
  schedule.scheduledJobs.forEach((job, name) => {
    jobs.push({
      name,
      nextRun: job.nextInvocation(),
      running: job.running
    });
  });
  res.json(jobs);
});

app.post('/api/schedule', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { name, cron, command } = req.body;
  try {
    schedule.scheduleJob(name, cron, async () => {
      try {
        await executeCommand(command);
        logActivity(null, 'scheduled_command', `Executed: ${command}`, 'system');
      } catch (err) {
        console.error(`Scheduled command failed: ${err.message}`);
      }
    });
    logActivity(req.user.id, 'create_schedule', `Created schedule: ${name}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/schedule/cancel', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { name } = req.body;
  try {
    const job = schedule.scheduledJobs.get(name);
    if (job) {
      job.cancel();
      logActivity(req.user.id, 'cancel_schedule', `Cancelled schedule: ${name}`, req.ip);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Job not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('serverStatus', serverStatus);
  
  socket.on('executeCommand', async (cmd) => {
    try {
      const response = await executeCommand(cmd);
      socket.emit('commandResponse', { success: true, response });
    } catch (err) {
      socket.emit('commandResponse', { success: false, error: err.message });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Panel server running on port ${PORT}`);
  connectRcon();
});

setInterval(async () => {
  if (serverStatus.online) {
    try {
      const memoryResponse = await executeCommand('memory');
      const match = memoryResponse.match(/(\d+)MB\/(\d+)MB/);
      if (match) {
        serverStatus.memory = { used: parseInt(match[1]), max: parseInt(match[2]) };
      }
    } catch (err) {}
  }
  io.emit('serverStatus', serverStatus);
}, 5000);
