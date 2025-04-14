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
        this.fav_remove_status = null;
        this.schhist_remove_status = null;

        // File paths in Dropbox - update with app folder path
        this.filePaths = {
            history: '/sync_data/search_history.json',
            favorites: '/sync_data/favorites.json',
            fav_remove_status: '/sync_data/fav_remove_status.json',
            schhist_remove_status: '/sync_data/schhist_remove_status.json'
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

                    // Ensure sync directory exists
                    await this.ensureSyncDirectory();

                    // Initialize remove status flags
                    this.fav_remove_status = await this.readFile(this.filePaths.fav_remove_status, {'status': false}) || {'status': false};
                    this.schhist_remove_status = await this.readFile(this.filePaths.schhist_remove_status, {'status': false}) || {'status': false};

                    await this.syncData();
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
            await this.syncData();
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

    async readFile(path, data = null) {
        let parsedData = null;
        const cachedItem = this.localCache.get(path);

        if (!this.isAuthenticated) {
            console.log('Not authenticated, returning null for path:', path);
            // return null;
            return cachedItem?.data || [];
        }

        try {
            // const client = this.dbx;
            console.log('Attempting to read file:', path);
            let response;

            try {
                response = await this.dbx.filesDownload({ path });
                console.log(`File ${path} exists and download initiated.`);
            } catch (downloadError) {
                if (downloadError.status === 409) {
                    console.log(`File ${path} does not exist, creating empty file...`);
                    
                    parsedData = data ? data : [];
                    
                    // Create empty file
                    await this.dbx.filesUpload({
                        path,
                        contents: JSON.stringify(parsedData),
                        mode: { '.tag': 'add' },
                        autorename: false,
                        mute: false
                    });

                    console.log(`Empty file ${path} uploaded successfully...`);

                    // Update cache
                    this.localCache.set(path, {
                        data: parsedData,
                        timestamp: Date.now()
                    });
                    return parsedData;
                } else {
                    throw downloadError;
                }
            }

            // const response = await this.dbx.filesDownload({ path });
            const blob = await response.result?.fileBlob;

            if (!blob) {
                // Handle cases where download response is okay but blob is missing
                if (response?.result?.size === 0) {
                    console.warn(`File ${path} downloaded but is empty. Returning empty array.`);
                    parsedData = []; // Treat empty file as empty array
                } else {
                    throw new Error(`Downloaded file content (Blob) could not be retrieved for ${path}. Response status: ${response?.status}`);
                }
            } else {
                const text = await blob.text();
                console.log(`Raw text received for ${path}:`, text);

                try {
                    parsedData = JSON.parse(text);
                } catch (parseError) {
                    console.error(`Failed to parse JSON from ${path}:`, parseError);
                    console.error(`Raw text that failed parsing:`, text);
                    // Decide how to handle parse errors. Return cache? Return null? Throw?
                    // Returning cache seems reasonable here.
                    console.log(`Returning cached data for ${path} due to parse error.`);
                    return cachedItem?.data || []; // Use consistent 'data' key for cache
                }
            }
            console.log(`File ${path} downloaded & parsed successfully.`);

            // Update cache with successfully parsed data
            this.localCache.set(path, {
                data: parsedData, // Use the consistent variable name and cache key
                timestamp: Date.now()
            });

            return parsedData;
        } catch (error) {
            console.error(`Failed to read file ${path}:`, error);

            // Handle specific error codes
            if (error.status === 400) {
                console.warn(`Invalid path format for ${path}, checking path...`);
                // You might want to attempt path correction here
                return data || [];
            }

            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    console.log('Token refreshed, retrying readFile...');
                    // Retry the operation
                    return this.readFile(path);
                } else {
                    console.error('Token refresh failed.');
                    // If refresh fails, don't retry. Fall through to return cache.
                    this.isAuthenticated = false; // Mark as unauthenticated
                }
            }
            return cachedItem?.data || [];
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
            console.log(`${ path } file uploaded successfully.`);

            // Update cache
            this.localCache.set(path, {
                data: data,
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
        // Ensure input is an array
        if (!Array.isArray(history)) {
            console.warn('normalizeSearchHistory received non-array input:', history);
            return [];
        }
        // Use map to return a new array
        return history.map(item => {
            // Handle both object {term: ..., lastSearched: ...} and simple string format
            const term = typeof item === 'string' ? item : item?.term;
            const lastSearched = item?.lastSearched || Date.now(); // Use existing or set current time

            // Return the standardized object, ensuring term is a string
            return {
                term: String(term || ''), // Ensure term is a string, default to empty
                lastSearched: lastSearched
            };
        }).filter(item => item.term); // Filter out entries with empty terms after normalization
    }

    // normalizeFavorites(favorites) {
    //     return favorites.forEach(item => ({
    //         title: item.title || '',
    //         favicon: item.favicon || '',
    //         url: item.url || '',
    //         pinned: item.pinned || false,
    //         lastModified: item.lastModified || Date.now(),
    //         order: item.order || 0
    //     }));
    // }

    normalizeFavorites(favorites) {
        // Ensure input is an array
        if (!Array.isArray(favorites)) {
            console.warn('normalizeFavorites received non-array input:', favorites);
            return [];
        }
        // Use map to return a new array
        return favorites.map((item, index) => {
            // Provide default values and ensure properties exist
            const url = String(item?.url || '');
            const title = String(item?.title || url || ''); // Use URL as fallback title
            const favicon = String(item?.favicon || '');
            const pinned = Boolean(item?.pinned || false);
            const lastModified = Number(item?.lastModified || Date.now());
            // Use the original index as a fallback for order if item.order isn't a valid number
            const order = typeof item?.order === 'number' ? item.order : index;
    
            return {
                title: title,
                favicon: favicon,
                url: url,
                pinned: pinned,
                lastModified: lastModified,
                order: order
            };
        }).filter(item => item.url); // Filter out entries without a valid URL after normalization
    }

    // mergeSearchHistory(local, remote) {
    //     const normalizedLocal = this.normalizeSearchHistory(local);
    //     const normalizedRemote = this.normalizeSearchHistory(remote);

    //     const merged = new Map();

    //     // Process local entries
    //     normalizedLocal.forEach(item => {
    //         merged.set(item.term, item);
    //     });

    //     // Merge remote entries, overwriting if newer
    //     normalizedRemote.forEach(item => {
    //         const existingItem = merged.get(item.term);
    //         // Ensure lastSearched is treated as a number for comparison
    //         const itemLastSearched = Number(item.lastSearched || 0);
    //         const existingLastSearched = Number(existingItem?.lastSearched || 0);

    //         if (!existingItem || itemLastSearched > existingLastSearched) {
    //             merged.set(item.term, item);
    //         }
    //     });

    //     return Array.from(merged.values())
    //         .sort((a, b) => Number(b.lastSearched || 0) - Number(a.lastSearched || 0));
    // }

    async mergeSearchHistory(local, remote, remove = false) {
        // Normalize both arrays first to ensure consistent object structure {term: string, lastSearched: number}
        const normalizedLocal = this.normalizeSearchHistory(local);
        const normalizedRemote = this.normalizeSearchHistory(remote);
    
        const merged = new Map(); // Use a Map to store the results based on unique terms
    
        if (this.schhist_remove_status.status) {
            // --- Intersection Logic (Keep Remote if in Both) ---
            console.log('Merging history with schhist_remove_status=true (intersection, prefer remote)');
            // Create a Set of terms present in the local data for efficient lookup
            const localTerms = new Set(normalizedLocal.map(item => item.term));
    
            // Iterate through remote items
            normalizedRemote.forEach(remoteItem => {
                // If the local item's term also exists remotely...
                if (localTerms.has(remoteItem.term)) {
                    // ...add the REMOTE item to the merged result. We prioritize the remote item's data
                    // when performing an intersection merge in the 'remove' scenario.
                    merged.set(remoteItem.term, remoteItem);
                }
                // If a remote item's term is NOT in localItems, it's implicitly excluded.
            });
            // The 'merged' map now contains only remote items that are also present locally.

            await this.writeFile(this.filePaths.schhist_remove_status, {'status': false});

        } else if (remove) {
            // --- Intersection Logic (Keep Local if in Both) ---
            console.log('Merging history with remove=true (intersection, prefer local)');
            // Create a Set of terms present in the remote data for efficient lookup
            const remoteTerms = new Set(normalizedRemote.map(item => item.term));
    
            // Iterate through local items
            normalizedLocal.forEach(localItem => {
                // If the local item's term also exists remotely...
                if (remoteTerms.has(localItem.term)) {
                    // ...add the LOCAL item to the merged result. We prioritize the local item's data
                    // when performing an intersection merge in the 'remove' scenario.
                    merged.set(localItem.term, localItem);
                }
                // If a local item's term is NOT in remoteTerms, it's implicitly excluded.
            });
            // The 'merged' map now contains only local items that are also present remotely.

            // this.writeFile(this.filePaths.schhist_remove_status, {'status': true});
    
        } else {
            // --- Standard Merge Logic (Keep Latest Timestamp) ---
            console.log('Merging history with remove=false (standard merge, keep latest)');
            // Process local entries first, adding them to the map
            normalizedLocal.forEach(item => {
                merged.set(item.term, item);
            });
    
            // Merge remote entries, potentially overwriting based on timestamp
            normalizedRemote.forEach(item => {
                const existingItem = merged.get(item.term);
                // Ensure lastSearched is treated as a number for comparison
                const itemLastSearched = Number(item.lastSearched || 0);
                const existingLastSearched = Number(existingItem?.lastSearched || 0);
    
                // Keep the item (either existing or new remote) with the later timestamp
                if (!existingItem || itemLastSearched > existingLastSearched) {
                    merged.set(item.term, item);
                }
                // If existingItem exists and has a later or equal timestamp, it remains unchanged.
            });
            // The 'merged' map now contains all unique terms, keeping the one with the latest timestamp.
        }
    
        // Convert the final map values (the selected history items) to an array
        // and sort by lastSearched date (most recent first)
        return Array.from(merged.values())
            .sort((a, b) => Number(b.lastSearched || 0) - Number(a.lastSearched || 0));
    }

    // mergeFavorites(local, remote) {
    //     // const normalizedLocal = this.normalizeFavorites(local);
    //     // const normalizedRemote = this.normalizeFavorites(remote);

    //     const merged = new Map();

    //     // Process local entries
    //     local.forEach(item => {
    //         merged.set(item.url, item);
    //     });

    //     // Merge remote entries
    //     remote.forEach(item => {
    //         const existingItem = merged.get(item.url);
    //         if (!existingItem || item.lastModified > existingItem.lastModified) {
    //             merged.set(item.url, item);
    //         }
    //     });

    //     return Array.from(merged.values())
    //         .sort((a, b) => {
    //             // Sort by pinned status first
    //             if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    //             // Then by order if available
    //             if (a.order !== b.order) return (a.order || 0) - (b.order || 0);
    //             // Finally by title
    //             return (a.title || '').localeCompare(b.title || '');
    //         });
    // }

    async mergeFavorites(local, remote, remove = false) {
        // Normalize both arrays first to ensure consistent object structure
        const normalizedLocal = this.normalizeFavorites(local);
        const normalizedRemote = this.normalizeFavorites(remote);
    
        const merged = new Map(); // Use a Map to store the results based on unique URLs
        if (this.fav_remove_status.status) {
            // --- Intersection Logic (Keep Remote if in Both) ---
            console.log('Merging favorites with remove_status=true (intersection, prefer remote)');
            // Create a Set of URLs present in the local data for efficient lookup
            const localUrls = new Set(normalizedLocal.map(item => item.url));

            // Iterate through remote items
            normalizedRemote.forEach(remoteItem => {
                // If the remote item's URL also exists locally...
                if (localUrls.has(remoteItem.url)) {
                    // ...add the REMOTE item to the merged result.
                    merged.set(remoteItem.url, remoteItem);
                }
                // If a remote item's URL is NOT in localUrls, it's excluded.
            });
            // The 'merged' map now contains only remote items whose URLs are also present locally.

            await this.writeFile(this.filePaths.fav_remove_status, {'status': true});

        } else if (remove) {
            // --- Intersection Logic (Keep Local if in Both) ---
            console.log('Merging favorites with remove=true (intersection, prefer local)');
            // Create a Set of URLs present in the remote data for efficient lookup
            const remoteUrls = new Set(normalizedRemote.map(item => item.url));
    
            // Iterate through local items
            normalizedLocal.forEach(localItem => {
                // If the local item's URL also exists remotely...
                if (remoteUrls.has(localItem.url)) {
                    // ...add the LOCAL item to the merged result.
                    merged.set(localItem.url, localItem);
                }
                // If a local item's URL is NOT in remoteUrls, it's excluded.
            });
            // The 'merged' map now contains only local items whose URLs are also present remotely.

            // this.writeFile(this.filePaths.fav_remove_status, {'status': true});
    
        } else {
            // --- Standard Merge Logic (Keep Latest Timestamp) ---
            console.log('Merging favorites with remove=false (standard merge, keep latest)');
            // Process local entries first
            normalizedLocal.forEach(item => {
                merged.set(item.url, item);
            });
    
            // Merge remote entries, overwriting if newer based on lastModified
            normalizedRemote.forEach(item => {
                const existingItem = merged.get(item.url);
                // Ensure lastModified is treated as a number for comparison
                const itemLastModified = Number(item.lastModified || 0);
                const existingLastModified = Number(existingItem?.lastModified || 0);
    
                // Keep the item (either existing or new remote) with the later timestamp
                if (!existingItem || itemLastModified > existingLastModified) {
                    merged.set(item.url, item);
                }
                // If existingItem exists and has a later or equal timestamp, it remains unchanged.
            });
            // The 'merged' map now contains all unique URLs, keeping the one with the latest timestamp.
        }
    
        // Convert the final map values to an array and sort according to the defined rules
        return Array.from(merged.values())
            .sort((a, b) => {
                // Sort by pinned status first (pinned items come first)
                if (a.pinned !== b.pinned) return b.pinned ? -1 : 1; // true comes before false
                // Then by order if available and different
                if ((a.order ?? Infinity) !== (b.order ?? Infinity)) return (a.order ?? Infinity) - (b.order ?? Infinity);
                // Finally by title (localeCompare is robust for string comparison)
                return (a.title || '').localeCompare(b.title || '');
            });
    }

    /**
     * 
     * @param {boolean} [remove=false] - If true, performs an intersection merge, keeping the local version.
     *                                   If false, performs a standard merge, keeping the latest version.
     * @returns {Array<object>} The merged and sorted favorites array.
     */
    async syncSearchHistory(remove = false) {
        this.schhist_remove_status = this.readFile(this.filePaths.schhist_remove_status, {'status': false});

        try {
            const localData = JSON.parse(localStorage.getItem('searchHistory') || '[]')
            // .map(term => ({ term, lastSearched: Date.now() }));

            const remoteData = await this.readFile(this.filePaths.history, []);

            // Ensure remoteData is an array, default to empty if not (readFile should handle this)
            const remoteDataObjects = Array.isArray(remoteData) ? remoteData : [];

            if (localData.length == remoteDataObjects.length === 0) {
                console.log('No local search history found on local or remote data. Nothing to sync.');
                await this.writeFile(this.filePaths.history, []);
                return [];
            }

            const mergedData = this.mergeSearchHistory(localData, remoteDataObjects, remove);
            await this.writeFile(this.filePaths.history, mergedData);

            // Filter out any items where term might have become null or empty somehow during merging/normalization
            const termsToSave = mergedData
            .map(item => item?.term) // Get the term
            .filter(term => term);   // Keep only non-empty, non-null terms

            // Update local storage
            localStorage.setItem('searchHistory',
                JSON.stringify(termsToSave));

            // return mergedData;
        } catch (error) {
            console.error('Failed to sync search history:', error);
            throw error;
        }
    }

    /**
     * 
     * @param {boolean} [remove=false] - If true, performs an intersection merge, keeping the local version.
     *                                   If false, performs a standard merge, keeping the latest version.
     * @returns {Array<object>} The merged and sorted favorites array.
     */
    async syncFavorites(remove = false) {
        this.fav_remove_status = this.readFile(this.filePaths.fav_remove_status, {'status': false});

        try {
            const localData = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            const remoteData = await this.readFile(this.filePaths.favorites, []);

            if (localData.length == remoteData.length === 0) {
                console.log('No local favorites found on local or remote data. Nothing to sync.');
                await this.writeFile(this.filePaths.favorites, []);
                return [];
            }

            const mergedData = this.mergeFavorites(localData, remoteData, remove);
            await this.writeFile(this.filePaths.favorites, mergedData);

            // Update local storage
            localStorage.setItem('mostVisited', JSON.stringify(mergedData));

            // return mergedData;
        } catch (error) {
            console.error('Failed to sync favorites:', error);
            throw error;
        }
    }

    async ensureSyncDirectory() {
        try {
            await this.dbx.filesCreateFolderV2({
                path: '/sync_data',
                autorename: false
            });
            console.log('Sync directory created');
        } catch (error) {
            // Ignore error if folder already exists (409 conflict)
            if (error.status !== 409) {
                console.error('Error creating sync directory:', error);
            }
        }
    }
}

export default browserSyncManager;