// browserSyncManager.js
import { initializeClient, authenticate, clearStoredAuth, refreshAccessToken, performManualAuthFlow, hasStoredAuth } from './nd-debug-env.js';
import { saveArrayToCache, getArrayFromCache, exportCachedArrayToFile, deleteCachedArray } from './nd-fileStorage.js';
import { isOnline } from './nd-networkUtils.js';
import { Buffer } from 'buffer'; // Import Buffer

class BrowserSyncManager {
    constructor() {
        this.dbx = null;
        this.isAuthenticated = false;
        // No localCache needed as fileStorage handles caching now
        this.offlineQueue = [];
        this.lastSync = null;
        this.syncInProgress = false;
        this.isCurrentlyOnline = true; // Assume online initially

        // File paths in Dropbox
        this.filePaths = {
            history: '/search_history.json',
            favorites: '/favorites.json'
        };

        // Initialize offline handling check interval
        this.setupOfflineHandling();
    }

    setupOfflineHandling() {
        // Periodically check network status in Node.js
        setInterval(async () => {
            const currentlyOnline = await isOnline();
            if (currentlyOnline && !this.isCurrentlyOnline) {
                this.isCurrentlyOnline = true;
                await this.handleOnline();
            } else if (!currentlyOnline && this.isCurrentlyOnline) {
                this.isCurrentlyOnline = false;
                this.handleOffline();
            }
        }, 15000); // Check every 15 seconds
    }

    async initialize() {
        try {
            if (!this.dbx) {
                this.dbx = await initializeClient();
                if (!this.dbx) {
                    throw new Error("Failed to initialize Dropbox client instance.");
                }
            }

            this.isCurrentlyOnline = await isOnline(); // Initial check

            const authValid = await authenticate(); // Checks stored token validity
            if (authValid) {
                this.isAuthenticated = true;
                console.log('Authentication successful (using stored/refreshed tokens)');
                try {
                    await this.testConnection(); // Test connection again after auth check
                    console.log('Dropbox connection verified');
                    // await this.syncData(); // Optional: Sync on init if desired
                    return true;
                } catch (error) {
                    console.error('Failed to verify Dropbox connection after auth:', error);
                    // Don't necessarily set isAuthenticated to false here,
                    // as auth might be valid but connection temporarily failed.
                    // Rely on subsequent operations to handle errors.
                    return false; // Indicate initialization had issues
                }
            } else {
                // Check if tokens exist but are invalid/expired
                if (await hasStoredAuth()) {
                    console.log('Stored authentication invalid/expired.');
                    await clearStoredAuth(); // Clear the bad tokens
                } else {
                    console.log('Authentication needed (no stored tokens).');
                }
                this.isAuthenticated = false;
                return false; // Indicate auth is needed
            }
        } catch (error) {
            console.error('Failed to initialize sync manager:', error);
            this.isAuthenticated = false;
            return false;
        }
    }

    // Renamed authenticateWithPopup to reflect the manual process
    async authenticateManually() {
        const authSuccess = await performManualAuthFlow();
        if (authSuccess) {
            this.isAuthenticated = true;
            // Re-initialize client if needed after successful auth
            this.dbx = await initializeClient();
            // await this.syncData(); // Optional: Sync after auth
            return true;
        }
        this.isAuthenticated = false;
        return false;
    }

    async testConnection() {
        if (!this.dbx) throw new Error('Dropbox client not initialized');
        try {
            // Try to get account information as a connection test
            const user = await this.dbx.usersGetCurrentAccount();
            console.log('Connection test successful for user:', user?.result?.email);
        } catch (error) {
            console.error('Connection test failed:', error);
            if (error.status === 401) {
                console.log('Token potentially invalid/expired during test connection.');
                // Attempt refresh if possible
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry test after refresh
                    const user = await this.dbx.usersGetCurrentAccount();
                    console.log('Connection test successful after refresh for user:', user?.result?.email);
                } else {
                    this.isAuthenticated = false; // Mark as not authenticated if refresh fails
                    throw new Error('Failed to refresh authentication token during test');
                }
            } else {
                throw error; // Re-throw other errors
            }
        }
    }

    async handleOnline() {
        console.log('Network status changed to online, processing queued operations...');
        await this.processOfflineQueue();
    }

    handleOffline() {
        console.log('Network status changed to offline, operations will be queued');
    }

    async processOfflineQueue() {
        if (!this.isCurrentlyOnline || this.syncInProgress) return;

        this.syncInProgress = true; // Use syncInProgress to lock queue processing
        console.log(`Processing offline queue (${this.offlineQueue.length} items)...`);

        // Process queue sequentially
        let successCount = 0;
        const failedTasks = [];

        while (this.offlineQueue.length > 0) {
            const task = this.offlineQueue.shift(); // Get first task
            console.log(`Processing task: ${task.type} for ${task.path}`);
            try {
                await this.processTask(task);
                successCount++;
            } catch (error) {
                console.error(`Failed to process task ${task.type} for ${task.path}:`, error);
                // Check if it was a network error, if so, requeue and stop
                if (!await isOnline()) {
                    console.log('Network connection lost during queue processing. Requeuing failed task and stopping.');
                    failedTasks.push(task); // Add the failed task back
                    this.isCurrentlyOnline = false; // Update status
                    break; // Stop processing the queue
                } else if (error.status === 401) {
                    console.log('Authentication error during queue processing. Attempting refresh...');
                    const refreshed = await refreshAccessToken();
                    if (refreshed) {
                        console.log('Token refreshed. Re-adding task to front of queue.');
                        failedTasks.push(task); // Re-add task to try again
                    } else {
                        console.error('Refresh failed. Task cannot be processed. Discarding.');
                        this.isAuthenticated = false; // Mark as unauthenticated
                        // Don't requeue if auth fails permanently
                    }
                }
                else {
                    // Other error, maybe temporary, requeue at the front
                    console.warn('Requeuing failed task due to non-auth/network error.');
                    failedTasks.push(task);
                }
            }
        }

        // Add any failed/re-queued tasks back to the *front* of the queue
        if (failedTasks.length > 0) {
            this.offlineQueue.unshift(...failedTasks);
        }

        console.log(`Offline queue processing finished. ${successCount} succeeded. ${this.offlineQueue.length} remaining.`);
        this.syncInProgress = false;
    }

    async processTask(task) {
        // No try-catch here, let errors bubble up to processOfflineQueue
        switch (task.type) {
            case 'write':
                await this.writeFileInternal(task.path, task.data);
                break;
            case 'delete':
                await this.deleteItemInternal(task.path, task.id);
                break;
            case 'reorder':
                await this.updateOrderInternal(task.path, task.order);
                break;
            default:
                console.warn(`Unknown task type: ${task.type}`);
        }
    }

    queueOperation(operation) {
        console.log(`Queuing operation: ${operation.type} for ${operation.path}`);
        this.offlineQueue.push({
            ...operation,
            timestamp: Date.now()
        });

        // Attempt to process immediately if online
        if (this.isCurrentlyOnline) {
            this.processOfflineQueue(); // Don't wait for interval
        } else {
            console.log('Currently offline, operation added to queue.');
        }
    }

    // --- Cache Methods (using fileStorage) ---
    async saveArrayToCache(dataArray, storeName = 'defaultStore') {
        return saveArrayToCache(dataArray, storeName);
    }

    async getArrayFromCache(storeName = 'defaultStore') {
        return getArrayFromCache(storeName);
    }

    async exportCachedArrayToFile(storeName = 'defaultStore', fileName = 'exported-data') {
        return exportCachedArrayToFile(storeName, fileName);
    }

    async deleteCachedArray(storeName = 'defaultStore') {
        return deleteCachedArray(storeName);
    }

    // --- Dropbox Interaction ---

    async readFile(path) {
        // Always try cache first for immediate access
        const cachedData = await this.getArrayFromCache(path); // Use path as store name for simplicity

        if (!this.isAuthenticated || !this.isCurrentlyOnline) {
            console.log(`Not authenticated or offline, returning cached data for path: ${path}`);
            return cachedData; // Return cached data if offline/unauth
        }

        try {
            if (!this.dbx) throw new Error('Dropbox client not initialized');
            console.log('Attempting to read file from Dropbox:', path);

            const response = await this.dbx.filesDownload({ path });
            console.log('File downloaded successfully from Dropbox.');

            // response.result.fileBinary is available in Node SDK
            const fileBuffer = response.result.fileBinary;
            if (!fileBuffer) {
                throw new Error('Downloaded file content is missing or empty.');
            }

            const fileContent = Buffer.from(fileBuffer).toString('utf8');
            const data = JSON.parse(fileContent);

            // Update cache with fresh data
            await this.saveArrayToCache(data, path);

            return data;
        } catch (error) {
            console.error(`Failed to read file ${path} from Dropbox:`, error?.error || error.message || error);
            // Handle common errors
            if (error.status === 409 && error.error?.error_summary?.startsWith('path/not_found/')) {
                console.log('File does not exist on Dropbox:', path);
                // Optionally create it here, or handle upstream
                // For now, just return cache (which might be empty)
                return cachedData;
            } else if (error.status === 401) {
                console.log('Authentication error during read, attempting refresh...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    return this.readFile(path); // Retry after refresh
                } else {
                    this.isAuthenticated = false; // Mark as unauthenticated
                }
            } else if (!await isOnline()) { // Check network on error
                this.isCurrentlyOnline = false;
                console.log('Network error during read.');
            }
            // For other errors or failed refresh, return cached data
            console.log(`Returning cached data for ${path} due to read error.`);
            return cachedData;
        }
    }

    // Internal write function used by queue processor and direct calls
    async writeFileInternal(path, data) {
        if (!this.isAuthenticated) throw new Error('Not authenticated');
        if (!this.dbx) throw new Error('Dropbox client not initialized');

        console.log('Attempting to write file to Dropbox:', path);
        const fileContent = JSON.stringify(data, null, 2); // Pretty print JSON

        await this.dbx.filesUpload({
            path: path,
            contents: fileContent,
            mode: { '.tag': 'overwrite' }, // Use specific tag for overwrite
            autorename: false,
            mute: false
        });
        console.log('File uploaded successfully to Dropbox.');

        // Update cache after successful write
        await this.saveArrayToCache(data, path);
    }

    async writeFile(path, data) {
        // Update cache immediately for responsiveness
        await this.saveArrayToCache(data, path);

        if (!this.isAuthenticated || !this.isCurrentlyOnline) {
            console.log(`Not authenticated or offline, queuing write operation for path: ${path}`);
            this.queueOperation({ type: 'write', path, data });
            return; // Return after queuing
        }

        try {
            await this.writeFileInternal(path, data);
        } catch (error) {
            console.error(`Failed to write to ${path}:`, error?.error || error.message || error);
            if (error.status === 401) {
                console.log('Authentication error during write, attempting refresh...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation immediately after refresh
                    console.log('Retrying write operation after refresh...');
                    try {
                        await this.writeFileInternal(path, data);
                    } catch (retryError) {
                        console.error(`Retry failed after refresh for ${path}:`, retryError);
                        this.queueOperation({ type: 'write', path, data }); // Queue if retry fails
                    }
                } else {
                    this.isAuthenticated = false; // Mark as unauthenticated
                    this.queueOperation({ type: 'write', path, data }); // Queue if refresh fails
                }
            } else {
                // Queue for other errors (including network)
                this.isCurrentlyOnline = await isOnline(); // Re-check network
                this.queueOperation({ type: 'write', path, data });
            }
        }
    }

    // Internal delete function
    async deleteItemInternal(filePath, itemId) {
        if (!this.isAuthenticated) throw new Error('Not authenticated');
        if (!this.dbx) throw new Error('Dropbox client not initialized');

        // 1. Read the current file content from Dropbox
        let data = [];
        try {
            const response = await this.dbx.filesDownload({ path: filePath });
            const fileBuffer = response.result.fileBinary;
            const fileContent = Buffer.from(fileBuffer).toString('utf8');
            data = JSON.parse(fileContent);
        } catch (error) {
            if (error.status === 409 && error.error?.error_summary?.startsWith('path/not_found/')) {
                console.log('File not found on Dropbox, nothing to delete from:', filePath);
                await this.saveArrayToCache([], filePath); // Clear cache too
                return; // Nothing to do
            }
            // Re-throw other read errors
            throw new Error(`Failed to read file ${filePath} before delete: ${error.message}`);
        }

        // 2. Filter out the item
        let itemFound = false;
        const updatedData = data.filter(item => {
            const keep = filePath === this.filePaths.history ?
                item.term !== itemId :
                item.url !== itemId;
            if (!keep) itemFound = true;
            return keep;
        });

        if (!itemFound) {
            console.log(`Item with ID ${itemId} not found in ${filePath}. No changes made.`);
            // Update cache even if no change remotely, to ensure consistency
            await this.saveArrayToCache(updatedData, filePath);
            return;
        }

        // 3. Write the updated data back
        console.log(`Attempting to write updated file after deleting item ${itemId} from ${filePath}`);
        const updatedContent = JSON.stringify(updatedData, null, 2);
        await this.dbx.filesUpload({
            path: filePath,
            contents: updatedContent,
            mode: { '.tag': 'overwrite' },
            autorename: false,
            mute: false
        });
        console.log(`Successfully updated ${filePath} after deletion.`);

        // 4. Update cache
        await this.saveArrayToCache(updatedData, filePath);
    }


    async deleteItem(path, itemId) {
        // Update cache optimistically
        const currentCache = await this.getArrayFromCache(path);
        const updatedCache = currentCache.filter(item => {
            return path === this.filePaths.history ? item.term !== itemId : item.url !== itemId;
        });
        await this.saveArrayToCache(updatedCache, path);


        if (!this.isAuthenticated || !this.isCurrentlyOnline) {
            console.log(`Not authenticated or offline, queuing delete operation for item ${itemId} in path: ${path}`);
            this.queueOperation({ type: 'delete', path, id: itemId });
            return;
        }

        try {
            await this.deleteItemInternal(path, itemId);
        } catch (error) {
            console.error(`Failed to delete item ${itemId} from ${path}:`, error?.error || error.message || error);
            // Similar error handling as writeFile
            if (error.status === 401) {
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    console.log(`Retrying delete operation for ${itemId} after refresh...`);
                    try {
                        await this.deleteItemInternal(path, itemId);
                    } catch (retryError) {
                        console.error(`Retry failed for delete ${itemId}:`, retryError);
                        this.queueOperation({ type: 'delete', path, id: itemId });
                    }
                } else {
                    this.isAuthenticated = false;
                    this.queueOperation({ type: 'delete', path, id: itemId });
                }
            } else {
                this.isCurrentlyOnline = await isOnline();
                this.queueOperation({ type: 'delete', path, id: itemId });
            }
        }
    }

    // Internal update order function
    async updateOrderInternal(filePath, newOrderIndices) {
        if (!this.isAuthenticated) throw new Error('Not authenticated');
        if (!this.dbx) throw new Error('Dropbox client not initialized');

        // 1. Read current data
        let data = [];
        try {
            const response = await this.dbx.filesDownload({ path: filePath });
            const fileBuffer = response.result.fileBinary;
            const fileContent = Buffer.from(fileBuffer).toString('utf8');
            data = JSON.parse(fileContent);
        } catch (error) {
            if (error.status === 409 && error.error?.error_summary?.startsWith('path/not_found/')) {
                console.log('File not found on Dropbox, cannot update order:', filePath);
                await this.saveArrayToCache([], filePath); // Clear cache
                return;
            }
            throw new Error(`Failed to read file ${filePath} before reorder: ${error.message}`);
        }

        // 2. Create reordered data
        const reorderedData = newOrderIndices.map((index, newArrayIndex) => {
            if (index >= 0 && index < data.length) {
                const item = data[index];
                // Add/update lastModified and potentially order property
                return {
                    ...item,
                    order: newArrayIndex, // Assign new order based on array position
                    lastModified: Date.now()
                };
            } else {
                console.warn(`Invalid index ${index} found in newOrderIndices for file ${filePath}. Skipping.`);
                return null; // Handle invalid indices
            }
        }).filter(item => item !== null); // Remove nulls from invalid indices


        // 3. Write back
        console.log(`Attempting to write updated file after reordering ${filePath}`);
        const updatedContent = JSON.stringify(reorderedData, null, 2);
        await this.dbx.filesUpload({
            path: filePath,
            contents: updatedContent,
            mode: { '.tag': 'overwrite' },
            autorename: false,
            mute: false
        });
        console.log(`Successfully updated ${filePath} after reorder.`);

        // 4. Update cache
        await this.saveArrayToCache(reorderedData, filePath);
    }

    async updateOrder(path, newOrderIndices) {
        // Optimistic cache update (more complex for reorder)
        const currentCache = await this.getArrayFromCache(path);
        const updatedCache = newOrderIndices.map((index, newArrayIndex) => {
            if (index >= 0 && index < currentCache.length) {
                const item = currentCache[index];
                return { ...item, order: newArrayIndex, lastModified: Date.now() };
            } return null;
        }).filter(item => item !== null);
        await this.saveArrayToCache(updatedCache, path);

        if (!this.isAuthenticated || !this.isCurrentlyOnline) {
            console.log(`Not authenticated or offline, queuing reorder operation for path: ${path}`);
            this.queueOperation({ type: 'reorder', path, order: newOrderIndices });
            return;
        }

        try {
            await this.updateOrderInternal(path, newOrderIndices);
        } catch (error) {
            console.error(`Failed to update order for ${path}:`, error?.error || error.message || error);
            // Similar error handling as writeFile/deleteItem
            if (error.status === 401) {
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    console.log(`Retrying reorder operation for ${path} after refresh...`);
                    try {
                        await this.updateOrderInternal(path, newOrderIndices);
                    } catch (retryError) {
                        console.error(`Retry failed for reorder ${path}:`, retryError);
                        this.queueOperation({ type: 'reorder', path, order: newOrderIndices });
                    }
                } else {
                    this.isAuthenticated = false;
                    this.queueOperation({ type: 'reorder', path, order: newOrderIndices });
                }
            } else {
                this.isCurrentlyOnline = await isOnline();
                this.queueOperation({ type: 'reorder', path, order: newOrderIndices });
            }
        }
    }

    // --- Sync Logic (Merging local cache with remote) ---

    // NOTE: Normalization might not be strictly needed if data format is consistent
    // but can help sanitize data before merging.
    normalizeSearchHistory(history) {
        if (!Array.isArray(history)) return [];
        return history.map(item => ({
            term: item?.term || String(item || ''), // Handle object or string, ensure term exists
            lastSearched: item?.lastSearched || Date.now()
        })).filter(item => item.term); // Ensure term is not empty
    }

    normalizeFavorites(favorites) {
        if (!Array.isArray(favorites)) return [];
        return favorites.map((item, index) => ({
            title: item?.title || '',
            favicon: item?.favicon || '',
            url: item?.url || '',
            pinned: item?.pinned || false,
            lastModified: item?.lastModified || Date.now(),
            order: typeof item?.order === 'number' ? item.order : index // Use index as fallback order
        })).filter(item => item.url); // Ensure url exists
    }

    mergeSearchHistory(local, remote) {
        const normalizedLocal = this.normalizeSearchHistory(local);
        const normalizedRemote = this.normalizeSearchHistory(remote);

        const merged = new Map();

        // Process local first, then remote, letting remote overwrite if newer
        [...normalizedLocal, ...normalizedRemote].forEach(item => {
            const existing = merged.get(item.term);
            if (!existing || item.lastSearched > existing.lastSearched) {
                merged.set(item.term, item);
            }
        });

        return Array.from(merged.values()).sort((a, b) => b.lastSearched - a.lastSearched);
    }

    mergeFavorites(local, remote) {
        const normalizedLocal = this.normalizeFavorites(local);
        const normalizedRemote = this.normalizeFavorites(remote);

        const merged = new Map();

        // Process local first, then remote
        [...normalizedLocal, ...normalizedRemote].forEach(item => {
            const existing = merged.get(item.url);
            // Merge strategy: Use item with later lastModified date.
            // If dates are same, potentially keep existing (local preference)? Or remote? Let's favor later date.
            if (!existing || item.lastModified > existing.lastModified) {
                merged.set(item.url, item);
            } else if (existing && item.lastModified === existing.lastModified) {
                // If dates match, potentially merge properties? Or just keep one?
                // Keeping the one already in map (which was local if processed first) is simpler.
                // Or, maybe explicitly favor remote properties if dates match? Let's stick to simple latest date wins.
            }
        });

        // Sort the final merged array
        return Array.from(merged.values())
            .sort((a, b) => {
                if (a.pinned !== b.pinned) return b.pinned ? -1 : 1; // Pinned first (true comes first)
                if (a.order !== b.order) return (a.order || 0) - (b.order || 0); // Then by order
                return (a.title || '').localeCompare(b.title || ''); // Finally by title
            });
    }


    async syncData() {
        if (this.syncInProgress) {
            console.log('Sync already in progress. Skipping.');
            return;
        }
        if (!this.isAuthenticated || !this.isCurrentlyOnline) {
            console.log('Cannot sync: Not authenticated or offline.');
            return;
        }

        this.syncInProgress = true;
        console.log('Starting data sync...');

        try {
            await Promise.all([
                this.syncFile(this.filePaths.history, this.mergeSearchHistory.bind(this)),
                this.syncFile(this.filePaths.favorites, this.mergeFavorites.bind(this))
            ]);

            this.lastSync = Date.now();
            console.log('Data sync completed successfully.');
        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    // Generic file sync function
    async syncFile(filePath, mergeFunction) {
        console.log(`Syncing file: ${filePath}`);
        try {
            // 1. Get local data (from cache file)
            const localData = await this.getArrayFromCache(filePath);

            // 2. Get remote data (use readFile which handles errors/cache fallback)
            const remoteData = await this.readFile(filePath); // readFile returns cache if remote fails

            // 3. Merge data
            // Ensure remoteData is an array before merging
            const mergedData = mergeFunction(localData, Array.isArray(remoteData) ? remoteData : []);

            // 4. Write merged data back to Dropbox (use writeFile which handles queueing/errors)
            // Only write if changes were made compared to remote (simple length check, could be smarter)
            if (JSON.stringify(mergedData) !== JSON.stringify(Array.isArray(remoteData) ? remoteData : [])) {
                console.log(`Data changed for ${filePath}, writing back to Dropbox...`);
                await this.writeFile(filePath, mergedData); // This also updates the cache
            } else {
                console.log(`No changes detected for ${filePath}. Cache updated.`);
                // Ensure cache is updated even if no remote write needed
                await this.saveArrayToCache(mergedData, filePath);
            }

            console.log(`Sync successful for ${filePath}`);
            return mergedData; // Return the synced data

        } catch (error) {
            console.error(`Failed to sync file ${filePath}:`, error);
            throw error; // Re-throw to be caught by syncData
        }
    }

    // Specific sync methods simplified using syncFile
    async syncSearchHistory() {
        return this.syncFile(this.filePaths.history, this.mergeSearchHistory.bind(this));
    }

    async syncFavorites() {
        return this.syncFile(this.filePaths.favorites, this.mergeFavorites.bind(this));
    }
}

export default BrowserSyncManager; // Use default export if preferred
// Or export { BrowserSyncManager }; // Use named export