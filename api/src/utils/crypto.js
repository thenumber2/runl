const crypto = require('crypto');
const { promisify } = require('util');
const logger = require('./logger');

// Promisify the pbkdf2 function
const pbkdf2Async = promisify(crypto.pbkdf2);

// The encryption algorithm to use
const ALGORITHM = 'aes-256-gcm';

/**
 * Utility class for encrypting and decrypting sensitive data
 * Updated to use asynchronous crypto operations
 */
class CryptoUtil {
  /**
   * Initialize crypto utility with a master key
   * @param {string} masterKey - The master encryption key
   */
  constructor(masterKey) {
    if (!masterKey || typeof masterKey !== 'string' || masterKey.length < 32) {
      throw new Error('Invalid master key: Must be at least 32 characters');
    }
    
    // Store the master key and salt for later use in deriveKey
    this.masterKey = masterKey;
    this.salt = 'runl-api-salt'; // Salt should ideally be stored securely
    this.keyPromise = this.deriveKey(); // Start key derivation immediately
  }
  
  /**
   * Derive the encryption key asynchronously
   * @private
   * @returns {Promise<Buffer>} - Derived key
   */
  async deriveKey() {
    try {
      // Create a fixed-length key using PBKDF2 (async version)
      return await pbkdf2Async(
        this.masterKey,
        this.salt,
        10000, // Iterations
        32, // Key length
        'sha256'
      );
    } catch (error) {
      logger.error('Error deriving encryption key:', {
        error: error.message,
        stack: error.stack
      });
      throw new Error('Failed to derive encryption key');
    }
  }
  
  /**
   * Ensure the key is derived and available
   * @private
   * @returns {Promise<Buffer>} - The derived key
   */
  async getKey() {
    return await this.keyPromise;
  }
  
  /**
   * Encrypt a string
   * @param {string} text - Text to encrypt
   * @returns {Promise<string>} - Encrypted text in format: iv:authTag:encryptedData (base64)
   */
  async encrypt(text) {
    if (!text) return text;
    
    try {
      // Get the derived key
      const key = await this.getKey();
      
      // Generate a random initialization vector
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      
      // Encrypt the data
      let encrypted = cipher.update(text, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      // Get the authentication tag
      const authTag = cipher.getAuthTag().toString('base64');
      
      // Return IV, auth tag, and encrypted data joined together
      return `${iv.toString('base64')}:${authTag}:${encrypted}`;
    } catch (error) {
      logger.error('Error encrypting data:', {
        error: error.message,
        stack: error.stack
      });
      throw new Error('Encryption failed');
    }
  }
  
  /**
   * Decrypt an encrypted string
   * @param {string} encryptedText - Text to decrypt (format: iv:authTag:encryptedData)
   * @returns {Promise<string>} - Decrypted text
   */
  async decrypt(encryptedText) {
    if (!encryptedText) return encryptedText;
    
    try {
      // Get the derived key
      const key = await this.getKey();
      
      // Split the encrypted text to get IV, auth tag, and data
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format');
      }
      
      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const encryptedData = parts[2];
      
      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt the data
      let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Error decrypting data:', {
        error: error.message,
        stack: error.stack
      });
      throw new Error('Decryption failed');
    }
  }
  
  /**
   * Check if a text is already encrypted
   * @param {string} text - Text to check
   * @returns {boolean} - Whether the text is encrypted
   */
  isEncrypted(text) {
    if (!text || typeof text !== 'string') return false;
    
    // Check if the text follows our encryption format
    const parts = text.split(':');
    if (parts.length !== 3) return false;
    
    try {
      // Try to decode the base64 parts
      Buffer.from(parts[0], 'base64');
      Buffer.from(parts[1], 'base64');
      
      // Check if the third part is valid base64
      Buffer.from(parts[2], 'base64');
      
      return true;
    } catch {
      return false;
    }
  }
}

// Create and export a singleton instance
const masterKey = process.env.ENCRYPTION_MASTER_KEY;
if (!masterKey) {
  logger.warn('ENCRYPTION_MASTER_KEY not set! Using a temporary key - NOT SECURE FOR PRODUCTION');
}

// Use environment variable or fallback to a development-only key
const cryptoUtil = new CryptoUtil(
  masterKey || 'development-only-key-do-not-use-in-production'
);

module.exports = cryptoUtil;