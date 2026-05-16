import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * PlayerManager - Manages player entries with Discord user ID, game, and in-game name
 * Persists data to a JSON file on the filesystem
 */
class PlayerManager {
    /**
   * Clean invisible/problematic Unicode characters
   * Removes zero-width spaces, soft hyphens, formatting marks, etc.
   * @param {string} str - String to clean
   * @returns {string} Cleaned string
   */
  static cleanUnicode(str) {
    if (typeof str !== 'string') return str;
    
    return str
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width characters
      .replace(/\u00AD/g, '')                // Soft hyphen
      .replace(/[\u2060\u2061\u2062\u2063\u2064\u2066\u2069]/g, '') // Invisible operators
      .replace(/[\u061C\u200E\u200F]/g, '')  // Direction marks
      .replace(/[\u180E\u2000-\u200A]/g, '') // Other invisible spaces
      .trim();
  }
  constructor(filePath = './players.json') {
    this.filePath = path.resolve(filePath);
    this.data = this.load();
  }

  /**
   * Load data from JSON file, or create empty structure if file doesn't exist
   */
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const rawData = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(rawData);
      }
    } catch (error) {
      console.error(`Error loading ${this.filePath}:`, error.message);
    }
    return {};
  }

  /**
   * Save data to JSON file
   */
  save() {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        'utf-8'
      );
      return true;
    } catch (error) {
      console.error(`Error saving to ${this.filePath}:`, error.message);
      return false;
    }
  }

  /**
   * Add or update a player entry
   * @param {string} discordUserId - Discord user ID
   * @param {string} game - Game title
   * @param {string} ign - In-game name
   */
  addOrUpdate(discordUserId, game, ign) {
    // Clean Unicode from inputs
    const cleanId = PlayerManager.cleanUnicode(String(discordUserId));
    const cleanGame = PlayerManager.cleanUnicode(game);
    const cleanIgn = PlayerManager.cleanUnicode(ign);
 
    if (!cleanId || !cleanGame || !cleanIgn) {
      throw new Error('discordUserId, game, and ign are required');
    }
 
    if (!this.data[cleanId]) {
      this.data[cleanId] = {};
    }
 
    this.data[cleanId][cleanGame] = cleanIgn;
    this.save();
 
    return {
      success: true,
      message: `Updated ${cleanId} for ${cleanGame}: ${cleanIgn}`
    };
  }

  /**
   * Get a player's IGN for a specific game
   * @param {string} discordUserId - Discord user ID
   * @param {string} game - Game title
   */
  get(discordUserId, game) {
    if (!this.data[discordUserId] || !this.data[discordUserId][game]) {
      return null;
    }
    return this.data[discordUserId][game];
  }

  /**
   * Get all games/IGNs for a specific player
   * @param {string} discordUserId - Discord user ID
   */
  getPlayer(discordUserId) {
    return this.data[discordUserId] || null;
  }

  /**
   * Remove a game entry for a player
   * @param {string} discordUserId - Discord user ID
   * @param {string} game - Game title
   */
  removeGame(discordUserId, game) {
    if (!this.data[discordUserId]) {
      return { success: false, message: 'Player not found' };
    }

    delete this.data[discordUserId][game];

    // Remove player entirely if no games left
    if (Object.keys(this.data[discordUserId]).length === 0) {
      delete this.data[discordUserId];
    }

    this.save();
    return { success: true, message: `Removed ${game} for ${discordUserId}` };
  }

  /**
   * Remove all entries for a player
   * @param {string} discordUserId - Discord user ID
   */
  removePlayer(discordUserId) {
    if (!this.data[discordUserId]) {
      return { success: false, message: 'Player not found' };
    }

    delete this.data[discordUserId];
    this.save();
    return { success: true, message: `Removed player ${discordUserId}` };
  }

  /**
   * Get all players
   */
  getAll() {
    return this.data;
  }

  /**
   * Check if a player exists
   * @param {string} discordUserId - Discord user ID
   */
  playerExists(discordUserId) {
    return !!this.data[discordUserId];
  }

  /**
   * Get count of players
   */
  playerCount() {
    return Object.keys(this.data).length;
  }

  /**
   * Clear all data
   */
  clear() {
    this.data = {};
    this.save();
    return { success: true, message: 'All data cleared' };
  }
}

export default PlayerManager;