// browserSyncManager.js
import { initializeClient, authenticate, clearStoredAuth, refreshAccessToken, openAuthPopup } from './debug-env.js';

class browserSyncManager {
    constructor() {
        // this.authManager = new AuthenticationManager(config);
        this.dbx = null;
        this.isAuthenticated = false;
        this.localCache = new Map();
        this.offlineQueue = [];
        this.lastSync = null;
        this.syncInProgress = false;

        // File paths in Dropbox
        this.filePaths = {
            history: '/search_history.json',
            favorites: '/favorites.json'
        };

        // Initialize offline handling
        this.setupOfflineHandling();
    }

    setupOfflineHandling() {
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    async initialize() {
        try {
            if (!this.dbx) {
                this.dbx = await initializeClient();
            }

            const isAuthValid = await authenticate()
            if (isAuthValid) {
                this.isAuthenticated = true;
                console.log('Authentication successful');

                try {
                    await this.testConnection(this.dbx);
                    console.log('Dropbox connection verified');
                    // await this.syncData();
                    return true;
                } catch (error) {
                    console.error('Failed to verify Dropbox connection:', error);
                    this.isAuthenticated = false;
                    return false;
                }
            } else {
                console.log('Authentication needed');
                this.isAuthenticated = false;
                return false;
            }
        } catch (error) {
            console.error('Failed to initialize sync manager:', error);
            this.isAuthenticated = false;
            return false;
        }
    }

    // Add a new method to handle the authentication popup
    async authenticateWithPopup() {
        const authSuccess = await openAuthPopup();
        if (authSuccess) {
            this.isAuthenticated = true;
            // await this.syncData();
            return true;
        }
        return false;
    }

    async testConnection(client) {
        // const client = this.authManager.getClient();
        try {
            // Try to get account information as a connection test
            const user = await client.usersGetCurrentAccount();
            console.log(user)
        } catch (error) {
            if (error.status === 401) {
                // Token might be expired, try to refresh
                const refreshed = await refreshAccessToken();
                if (!refreshed) {
                    throw new Error('Failed to refresh authentication token');
                }
            } else {
                throw error;
            }
        }
    }

    async handleOnline() {
        console.log('Device is online, processing queued operations...');
        await this.processOfflineQueue();
    }

    handleOffline() {
        console.log('Device is offline, operations will be queued');
    }

    async processOfflineQueue() {
        if (!navigator.onLine || this.syncInProgress) return;

        this.syncInProgress = true;

        try {
            while (this.offlineQueue.length > 0) {
                const task = this.offlineQueue.shift();
                await this.processTask(task);
            }
        } catch (error) {
            console.error('Failed to process offline queue:', error);
            // Re-queue failed tasks
            this.offlineQueue.unshift(...this.offlineQueue);
        } finally {
            this.syncInProgress = false;
        }
    }

    async processTask(task) {
        try {
            switch (task.type) {
                case 'write':
                    await this.writeFile(task.path, task.data);
                    break;
                case 'delete':
                    await this.deleteItem(task.path, task.id);
                    break;
                case 'reorder':
                    await this.updateOrder(task.path, task.order);
                    break;
            }
        } catch (error) {
            console.error(`Failed to process task ${task.type}:`, error);
            throw error;
        }
    }

    queueOperation(operation) {
        this.offlineQueue.push({
            ...operation,
            timestamp: Date.now()
        });

        if (navigator.onLine) {
            this.processOfflineQueue();
        }
    }

    /**
     * Saves an array to browser cache (IndexedDB) and provides export functionality
     * @param {Array} dataArray - The array to save
     * @param {string} storeName - Name of the store/collection (used as identifier)
     * @returns {Promise} - Promise resolving to the operation result
     */
    async saveArrayToCache(dataArray, storeName = 'defaultStore') {
        // Database configuration
        const DB_NAME = 'CachedArraysDB';
        const DB_VERSION = 1;

        return new Promise(async (resolve, reject) => {
            try {
                // Open the database
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                // Handle database upgrade (first time or version change)
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create object store if it doesn't exist
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                    }
                };

                // Handle database open success
                request.onsuccess = async (event) => {
                    const db = event.target.result;

                    // Check if the store exists, if not create it
                    if (!db.objectStoreNames.contains(storeName)) {
                        // Close the db to update version
                        db.close();
                        const reopenRequest = indexedDB.open(DB_NAME, DB_VERSION + 1);

                        reopenRequest.onupgradeneeded = (event) => {
                            const db = event.target.result;
                            db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                        };

                        reopenRequest.onsuccess = (event) => {
                            handleDatabase(event.target.result);
                        };

                        reopenRequest.onerror = (event) => {
                            reject(new Error(`Failed to create store: ${event.target.error}`));
                        };
                    } else {
                        handleDatabase(db);
                    }

                    // Main database operations
                    async function handleDatabase(db) {
                        // Start a transaction and get the store
                        const transaction = db.transaction([storeName], 'readwrite');
                        const store = transaction.objectStore(storeName);

                        // Get all existing items
                        const getAllRequest = store.getAll();

                        getAllRequest.onsuccess = () => {
                            const existingData = getAllRequest.result || [];

                            // Merge arrays and ensure uniqueness
                            let mergedArray;

                            // Check if items have IDs
                            const hasIds = dataArray.length > 0 && dataArray[0].hasOwnProperty('id');

                            if (hasIds) {
                                // Create a map of existing items by ID
                                const idMap = new Map();

                                // Add existing items to map
                                existingData.forEach(item => {
                                    if (item.hasOwnProperty('id')) {
                                        idMap.set(item.id, item);
                                    }
                                });

                                // Add or update with new items
                                dataArray.forEach(item => {
                                    if (item.hasOwnProperty('id')) {
                                        idMap.set(item.id, item);
                                    }
                                });

                                mergedArray = Array.from(idMap.values());
                            } else {
                                // For arrays without ID, use JSON stringification for comparison
                                const uniqueSet = new Set();

                                // Convert existing items to strings for uniqueness check
                                existingData.forEach(item => {
                                    uniqueSet.add(JSON.stringify(item));
                                });

                                // Add new items if unique
                                dataArray.forEach(item => {
                                    uniqueSet.add(JSON.stringify(item));
                                });

                                // Convert back to objects
                                mergedArray = Array.from(uniqueSet).map(item => JSON.parse(item));
                            }

                            // Clear the store first
                            const clearRequest = store.clear();

                            clearRequest.onsuccess = () => {
                                // Add all merged items back
                                const addPromises = mergedArray.map(item => {
                                    return new Promise((resolveAdd, rejectAdd) => {
                                        const addRequest = store.add(item);
                                        addRequest.onsuccess = () => resolveAdd();
                                        addRequest.onerror = (e) => rejectAdd(e.target.error);
                                    });
                                });

                                Promise.all(addPromises)
                                    .then(() => {
                                        resolve({
                                            success: true,
                                            message: `Successfully saved ${mergedArray.length} items to cache (${storeName})`,
                                            data: mergedArray,
                                            storeName: storeName
                                        });
                                    })
                                    .catch(error => {
                                        reject(new Error(`Failed to add items: ${error.message}`));
                                    });
                            };

                            clearRequest.onerror = (event) => {
                                reject(new Error(`Failed to clear store: ${event.target.error}`));
                            };
                        };

                        getAllRequest.onerror = (event) => {
                            reject(new Error(`Failed to get existing data: ${event.target.error}`));
                        };

                        // Handle transaction errors
                        transaction.onerror = (event) => {
                            reject(new Error(`Transaction error: ${event.target.error}`));
                        };
                    }
                };

                // Handle database open error
                request.onerror = (event) => {
                    reject(new Error(`Database error: ${event.target.error}`));
                };
            } catch (error) {
                reject(new Error(`Unexpected error: ${error.message}`));
            }
        });
    }

    /**
     * Retrieves array data from the browser cache
     * @param {string} storeName - Name of the store to retrieve
     * @returns {Promise} - Promise resolving to the array data
     */
    async getArrayFromCache(storeName = 'defaultStore') {
        const DB_NAME = 'CachedArraysDB';

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME);

            request.onsuccess = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(storeName)) {
                    resolve([]);
                    return;
                }

                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = () => {
                    resolve(getAllRequest.result || []);
                };

                getAllRequest.onerror = (event) => {
                    reject(new Error(`Failed to get data: ${event.target.error}`));
                };
            };

            request.onerror = (event) => {
                reject(new Error(`Database error: ${event.target.error}`));
            };
        });
    }

    /**
     * Exports the cached array to a downloadable JSON file
     * @param {string} storeName - Name of the store to export
     * @param {string} fileName - Name for the exported file (without extension)
     * @returns {Promise} - Promise resolving to the export result
     */
    async exportCachedArrayToFile(storeName = 'defaultStore', fileName = 'exported-data') {
        try {
            // Get the data from cache
            const cachedData = await getArrayFromCache(storeName);

            if (cachedData.length === 0) {
                return {
                    success: false,
                    message: `No data found in cache for store: ${storeName}`
                };
            }

            // Ensure the file has .json extension
            if (!fileName.endsWith('.json')) {
                fileName += '.json';
            }

            // Create a blob and download
            const jsonString = JSON.stringify(cachedData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });

            // Use FileSaver if available, or fall back to native methods
            if (typeof saveAs === 'function') {
                saveAs(blob, fileName);
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                document.body.appendChild(a);
                a.style.display = 'none';
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }

            return {
                success: true,
                message: `Successfully exported ${cachedData.length} items to ${fileName}`,
                data: cachedData
            };
        } catch (error) {
            console.error('Error exporting cached data:', error);
            return {
                success: false,
                message: `Failed to export: ${error.message}`
            };
        }
    }

    /**
     * Deletes a store from the cache
     * @param {string} storeName - Name of the store to delete
     * @returns {Promise} - Promise resolving to the operation result
     */
    async deleteCachedArray(storeName = 'defaultStore') {
        const DB_NAME = 'CachedArraysDB';

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME);

            request.onsuccess = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(storeName)) {
                    resolve({
                        success: false,
                        message: `Store ${storeName} doesn't exist`
                    });
                    return;
                }

                // Close the connection and reopen with a new version to delete the store
                const version = db.version + 1;
                db.close();

                const deleteRequest = indexedDB.open(DB_NAME, version);

                deleteRequest.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    db.deleteObjectStore(storeName);
                };

                deleteRequest.onsuccess = () => {
                    resolve({
                        success: true,
                        message: `Successfully deleted store: ${storeName}`
                    });
                };

                deleteRequest.onerror = (event) => {
                    reject(new Error(`Failed to delete store: ${event.target.error}`));
                };
            };

            request.onerror = (event) => {
                reject(new Error(`Database error: ${event.target.error}`));
            };
        });
    }

    async readFile(path) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, returning null for path:', path);
            return null;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            console.log('Attempting to read file:', path);

            // First check if the file exists
            try {
                await this.dbx.filesGetMetadata({ path });
            } catch (error) {
                if (error.status === 409) {
                    console.log('File does not exist, creating empty file:', path);
                    // Create empty file
                    const response = await this.dbx.filesUpload({
                        path,
                        contents: JSON.stringify([]),
                        mode: 'add',
                        autorename: true,
                        mute: false
                    });
                    console.log('File uploaded successfully');
                    const data = JSON.parse(await response.fileBlob);

                    // Update cache
                    this.localCache.set(path, {
                        data,
                        timestamp: Date.now()
                    });
                    return [];
                }
                // throw error;
                console.error(`Failed to get file metadata ${path}:`, error);
            }

            const response = await this.dbx.filesDownload({ path });
            console.log('File downloaded successfully');
            const blob = await response.fileBlob;
            // const data = await blob.JSON();
            // const data = JSON.parse(text);
            console.log(`file ${path}: ${blob}`);

            // Update cache
            this.localCache.set(path, {
                blob,
                timestamp: Date.now()
            });

            return blob;
        } catch (error) {
            console.error(`Failed to read file ${path}:`, error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.readFile(path);
                }
            }
            return this.localCache.get(path)?.data || null;
        }
    }

    async writeFile(path, data) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, queuing operations for path:', path);
            this.queueOperation({ type: 'write', path, data });
            return;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            console.log('Attempting to write file:', path);

            await this.dbx.filesUpload({
                path,
                contents: JSON.stringify(data),
                mode: 'overwrite',
                autorename: false,
                mute: false
            });
            console.log('File uploaded successfully.');

            // Update cache
            this.localCache.set(path, {
                data,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Failed to write to ${path}:`, error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.writeFile(path, data);
                }
            }
            this.queueOperation({ type: 'write', path, data });
        }
    }

    async deleteItem(path, itemId) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, queuing operations for path:', path);
            this.queueOperation({ type: 'delete', path, itemId });
            return;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            const data = await this.readFile(path) || [];
            console.log('Attempting to read file:', path);

            // First check if the file exists
            try {
                await this.dbx.filesGetMetadata({ path });
            } catch (error) {
                if (error.status === 409) {
                    console.log('File does not exist, nothing to delete:', path);
                    return [];
                }
                throw error;
            }

            const updatedData = data.filter(item => {
                return path === this.filePaths.history ?
                    item.term !== itemId :
                    item.url !== itemId;
            });

            await this.writeFile(path, updatedData);
        } catch (error) {
            console.error(`Failed to delete item from ${path}:`, error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.deleteItem(path, itemId);
                }
            }
            this.queueOperation({ type: 'delete', path, itemId });
        }
    }

    async updateOrder(path, newOrder) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, queuing operations for path:', path);
            this.queueOperation({ type: 'reorder', path, order: newOrder });
            return;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            const data = await this.readFile(path) || [];
            console.log('Attempting to read file:', path);

            // First check if the file exists
            try {
                await this.dbx.filesGetMetadata({ path });
            } catch (error) {
                if (error.status === 409) {
                    console.log('File does not exist, nothing to update:', path);
                    return null;
                }
                throw error;
            }

            const reorderedData = newOrder.map(index => ({
                ...data[index],
                lastModified: Date.now()
            }));

            await this.writeFile(path, reorderedData);
        } catch (error) {
            console.error('Failed to update order:', error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.updateOrder(path, newOrder);
                }
            }
            this.queueOperation({ type: 'reorder', path, order: newOrder });
        }
    }

    async syncData() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;

        try {
            await Promise.all([
                this.syncSearchHistory(),
                this.syncFavorites()
            ]);

            this.lastSync = Date.now();
        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    normalizeSearchHistory(history) {
        console.log(`Data: ${JSON.stringify(history)}`);
        console.log(`Data type: ${typeof history}`);
        return history.forEach(item => ({
            term: item.term || item, // Handle both string and object format
            lastSearched: item.lastSearched || Date.now()
        }));
    }

    normalizeFavorites(favorites) {
        return favorites.forEach(item => ({
            title: item.title || '',
            favicon: item.favicon || '',
            url: item.url || '',
            pinned: item.pinned || false,
            lastModified: item.lastModified || Date.now(),
            order: item.order || 0
        }));
    }

    mergeSearchHistory(local, remote) {
        // const normalizedLocal = this.normalizeSearchHistory(local);
        // const normalizedRemote = this.normalizeSearchHistory(remote);

        const merged = new Map();

        // Process local entries
        local.forEach(item => {
            merged.set(item.term, item);
        });

        // Merge remote entries
        remote.forEach(item => {
            const existingItem = merged.get(item.term);
            if (!existingItem || item.lastSearched > existingItem.lastSearched) {
                merged.set(item.term, item);
            }
        });

        return Array.from(merged.values()).sort((a, b) => b.lastSearched - a.lastSearched);
    }

    mergeFavorites(local, remote) {
        // const normalizedLocal = this.normalizeFavorites(local);
        // const normalizedRemote = this.normalizeFavorites(remote);

        const merged = new Map();

        // Process local entries
        local.forEach(item => {
            merged.set(item.url, item);
        });

        // Merge remote entries
        remote.forEach(item => {
            const existingItem = merged.get(item.url);
            if (!existingItem || item.lastModified > existingItem.lastModified) {
                merged.set(item.url, item);
            }
        });

        return Array.from(merged.values())
            .sort((a, b) => {
                // Sort by pinned status first
                if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
                // Then by order if available
                if (a.order !== b.order) return (a.order || 0) - (b.order || 0);
                // Finally by title
                return (a.title || '').localeCompare(b.title || '');
            });
    }

    async syncSearchHistory() {
        try {
            const localData = JSON.parse(localStorage.getItem('searchHistory') || '[]')
            // .map(term => ({ term, lastSearched: Date.now() }));

            const remoteData = await this.readFile(this.filePaths.history);

            const mergedData = this.mergeSearchHistory(localData, remoteData);
            await this.writeFile(this.filePaths.history, mergedData);

            // Update local storage
            localStorage.setItem('searchHistory',
                JSON.stringify(mergedData.map(item => item.term)));

            return mergedData;
        } catch (error) {
            console.error('Failed to sync search history:', error);
            throw error;
        }
    }

    async syncFavorites() {
        try {
            const localData = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            const remoteData = await this.readFile(this.filePaths.favorites);

            const mergedData = this.mergeFavorites(localData, remoteData);
            await this.writeFile(this.filePaths.favorites, mergedData);

            // Update local storage
            localStorage.setItem('mostVisited', JSON.stringify(mergedData));

            return mergedData;
        } catch (error) {
            console.error('Failed to sync favorites:', error);
            throw error;
        }
    }
}

export default browserSyncManager;