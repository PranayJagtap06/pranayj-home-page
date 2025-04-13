// fileStorage.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Helper to get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, 'cache');
const AUTH_STATE_FILE = path.join(__dirname, 'auth_state.json');

// Ensure cache directory exists
const ensureCacheDir = async () => {
    try {
        await fs.access(CACHE_DIR);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(CACHE_DIR, { recursive: true });
            console.log(`Created cache directory: ${CACHE_DIR}`);
        } else {
            throw error;
        }
    }
};

// --- Auth State Storage ---

export const readAuthState = async () => {
    try {
        await fs.access(AUTH_STATE_FILE);
        const data = await fs.readFile(AUTH_STATE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null; // File doesn't exist
        }
        console.error('Error reading auth state:', error);
        return null;
    }
};

export const writeAuthState = async (authState) => {
    try {
        await fs.writeFile(AUTH_STATE_FILE, JSON.stringify(authState, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error writing auth state:', error);
    }
};

export const clearAuthState = async () => {
    try {
        await fs.unlink(AUTH_STATE_FILE);
        console.log('Cleared stored auth state file.');
    } catch (error) {
        if (error.code !== 'ENOENT') { // Ignore if file doesn't exist
            console.error('Error clearing auth state file:', error);
        }
    }
};

// --- Cache (IndexedDB Replacement) ---

const getCacheFilePath = (storeName) => {
    // Sanitize storeName to prevent path traversal issues
    const safeStoreName = path.basename(storeName).replace(/[^a-z0-9_-]/gi, '_');
    return path.join(CACHE_DIR, `${safeStoreName}.json`);
};

export const saveArrayToCache = async (dataArray, storeName = 'defaultStore') => {
    await ensureCacheDir();
    const filePath = getCacheFilePath(storeName);
    let mergedArray = [];

    try {
        // Read existing data
        let existingData = [];
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            existingData = JSON.parse(fileContent);
        } catch (readError) {
            if (readError.code !== 'ENOENT') throw readError; // Rethrow unexpected errors
            // File doesn't exist, which is fine
        }

        // Merge logic (similar to original IndexedDB logic)
        const hasIds = dataArray.length > 0 && dataArray[0]?.hasOwnProperty('id');

        if (hasIds) {
            const idMap = new Map(existingData.map(item => [item.id, item]));
            dataArray.forEach(item => { if (item.hasOwnProperty('id')) idMap.set(item.id, item); });
            mergedArray = Array.from(idMap.values());
        } else {
            const uniqueSet = new Set(existingData.map(item => JSON.stringify(item)));
            dataArray.forEach(item => uniqueSet.add(JSON.stringify(item)));
            mergedArray = Array.from(uniqueSet).map(item => JSON.parse(item));
        }

        // Write merged data back
        await fs.writeFile(filePath, JSON.stringify(mergedArray, null, 2), 'utf-8');

        return {
            success: true,
            message: `Successfully saved ${mergedArray.length} items to cache (${storeName})`,
            data: mergedArray,
            storeName: storeName
        };

    } catch (error) {
        console.error(`Error saving array to cache (${storeName}):`, error);
        return {
            success: false,
            message: `Failed to save to cache: ${error.message}`
        };
    }
};

export const getArrayFromCache = async (storeName = 'defaultStore') => {
    await ensureCacheDir();
    const filePath = getCacheFilePath(storeName);
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return []; // Return empty array if cache file doesn't exist
        }
        console.error(`Error getting array from cache (${storeName}):`, error);
        return []; // Return empty on other errors as well
    }
};

export const exportCachedArrayToFile = async (storeName = 'defaultStore', outputFileName = 'exported-data') => {
    await ensureCacheDir();
    try {
        const cachedData = await getArrayFromCache(storeName);
        if (cachedData.length === 0) {
            return { success: false, message: `No data found in cache for store: ${storeName}` };
        }

        const safeOutputFileName = path.basename(outputFileName).replace(/[^a-z0-9_.-]/gi, '_');
        const finalFileName = safeOutputFileName.endsWith('.json') ? safeOutputFileName : `${safeOutputFileName}.json`;
        const outputPath = path.join(__dirname, finalFileName); // Export to script's directory

        await fs.writeFile(outputPath, JSON.stringify(cachedData, null, 2), 'utf-8');

        return {
            success: true,
            message: `Successfully exported ${cachedData.length} items to ${finalFileName}`,
            data: cachedData
        };
    } catch (error) {
        console.error('Error exporting cached data:', error);
        return { success: false, message: `Failed to export: ${error.message}` };
    }
};

export const deleteCachedArray = async (storeName = 'defaultStore') => {
    await ensureCacheDir();
    const filePath = getCacheFilePath(storeName);
    try {
        await fs.unlink(filePath);
        return { success: true, message: `Successfully deleted cache file for store: ${storeName}` };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { success: false, message: `Cache file for store ${storeName} doesn't exist` };
        }
        console.error(`Error deleting cache file for store ${storeName}:`, error);
        return { success: false, message: `Failed to delete cache: ${error.message}` };
    }
};