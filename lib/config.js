const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  musicDir: path.join(os.homedir(), 'Music', 'mp3'),
  port: parseInt(process.env.PORT, 10) || 8080,
  host: '0.0.0.0',
  cacheDir: path.join(__dirname, '..', '.cache')
};

let currentConfig = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      currentConfig = { ...DEFAULT_CONFIG, ...data };
    } else {
      currentConfig = { ...DEFAULT_CONFIG };
      saveConfig(currentConfig);
    }
  } catch (err) {
    console.error('Error loading config, using defaults:', err.message);
    currentConfig = { ...DEFAULT_CONFIG };
  }
  
  // Ensure cache directory exists
  if (!fs.existsSync(currentConfig.cacheDir)) {
    try {
      fs.mkdirSync(currentConfig.cacheDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create cache dir:', e.message);
    }
  }
  
  const artworkDir = path.join(currentConfig.cacheDir, 'artwork');
  if (!fs.existsSync(artworkDir)) {
    try {
      fs.mkdirSync(artworkDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create artwork cache dir:', e.message);
    }
  }

  return currentConfig;
}

function saveConfig(newConfig) {
  try {
    currentConfig = { ...currentConfig, ...newConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf8');
    return currentConfig;
  } catch (err) {
    console.error('Error saving config:', err.message);
    return currentConfig;
  }
}

function getConfig() {
  return currentConfig;
}

// Initial load
loadConfig();

module.exports = {
  loadConfig,
  saveConfig,
  getConfig,
  CONFIG_FILE
};
