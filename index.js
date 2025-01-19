// index.js
import browserSyncManager from "./bwsrsync.js";

// Suggestions Manager Class
class SearchSuggestionsManager {
    constructor(syncManager) {
        this.syncManager = syncManager;
        this.searchBar = document.querySelector('.search-bar');
        this.suggestionsContainer = document.createElement('div');
        this.suggestionsContainer.className = 'search-suggestions';
        this.searchBar.parentNode.appendChild(this.suggestionsContainer);

        this.currentEngine = 'duckduckgo';
        this.selectedIndex = -1;
        this.suggestions = [];
        this.recentSearches = [];
        this.debounceTimeout = null;

        // Initialize with synced data if available
        this.initializeSyncedData();
        this.setupEventListeners();
    }

    async initializeSyncedData() {
        try {
            // Load from local storage first
            this.recentSearches = this.loadRecentSearches();
            if (this.syncManager && this.syncManager.isAuthenticated) {
                // Wait for initial sync from dropbox if auth successfull
                await this.syncManager.syncData();
                // Update from synced history
                this.recentSearches = this.loadRecentSearches();
            }
        } catch (error) {
            console.warn('Failed to initialize synced data:', error);
        }
    }

    // Initialize event listeners
    setupEventListeners() {
        this.searchBar.addEventListener('input', () => this.handleInput());
        this.searchBar.addEventListener('keydown', (e) => this.handleKeydown(e));
        document.addEventListener('click', (e) => this.handleClickOutside(e));
    }

    // Load recent searches from localStorage
    loadRecentSearches() {
        this.recentSearches = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    }

    saveLocalSearch(query) {
        if (!query) return;
        this.recentSearches = [
            query,
            ...this.recentSearches.filter(s => s !== query)
        ];
        localStorage.setItem('searchHistory', JSON.stringify(this.recentSearches));
    }

    // Handle input changes
    async handleInput() {
        const query = this.searchBar.value.trim();

        // Clear previous timeout
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }

        if (query.length < 2) {
            this.hideSuggestions();
            return;
        }

        this.debounceTimeout = setTimeout(async () => {
            try {
                const internetSuggestions = await this.fetchSuggestions(query);
                const recentMatches = this.getRecentMatches(query);

                // Combine suggestions, prioritizing recent matches
                this.suggestions = [
                    ...recentMatches,
                    ...internetSuggestions.filter(
                        suggestion =>
                            !recentMatches.some(recent => recent.text === suggestion.text)
                    )
                ].slice(0, 30); // Limit to 30 suggestions

                // Show suggestions if we have any
                if (this.suggestions.length > 0) {
                    this.showSuggestions();
                } else {
                    this.hideSuggestions();
                }
            } catch (error) {
                console.error('Suggestions error:', error);
                this.suggestions = this.getFallbackSuggestions(query);
                // this.showSuggestions();
                this.hideSuggestions();
            }
        }, 300);
    }

    // Get matching recent searches
    getRecentMatches(query) {
        return this.recentSearches
            .filter(search => search.toLowerCase().includes(query.toLowerCase()))
            .map(search => ({
                text: search,
                type: 'recent',
                icon: '🕒'
            }));
    }

    // Fetch suggestions from search engines
    async fetchSuggestions(query) {
        try {
            // Use Netlify function instead of direct API calls
            const response = await fetch(
                `/.netlify/functions/suggestions?query=${encodeURIComponent(query)}&engine=${this.currentEngine}`
            );

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Suggestions API request failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorText
                });
                throw new Error('Suggestions API request failed');
            }

            const suggestions = await response.json();
            console.log('Raw Suggestions:', suggestions);

            // if (suggestions.error) {
            //     throw new Error(suggestions.error);
            // }

            if (!suggestions || suggestions.length === 0) {
                console.warn('No suggestions returned');
                return this.getFallbackSuggestions(query);
            }

            console.log('Internet Suggestions:', suggestions.map(s => s.text));

            // Ensure that each suggestion has a 'text' property
            return suggestions.map(suggestion => ({
                text: suggestion.text || '', // Set a default value if 'text' is missing
                type: 'suggestion',
                icon: '🔍'
            }));

        } catch (error) {
            console.error('Failed to fetch suggestions:', error);
            return this.getFallbackSuggestions(query);
        }
    }

    // Show suggestions in the UI
    showSuggestions() {
        if (this.suggestions.length === 0) {
            this.hideSuggestions();
            return;
        }

        const html = this.suggestions.map((suggestion, index) => `
            <div class="suggestion-item ${index === this.selectedIndex ? 'selected' : ''}" 
                 data-index="${index}">
                <span class="suggestion-icon">${suggestion.icon}</span>
                <span class="suggestion-text">${this.highlightMatch(suggestion.text)}</span>
                ${suggestion.type === 'recent' ?
                '<button class="remove-suggestion">×</button>' : ''}
            </div>
        `).join('');

        this.suggestionsContainer.innerHTML = html;
        this.suggestionsContainer.style.display = 'block';

        // Add click listeners
        this.suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => this.selectSuggestion(parseInt(item.dataset.index)));
        });

        this.suggestionsContainer.querySelectorAll('.remove-suggestion').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.parentElement.dataset.index);
                this.removeRecentSearch(index);
            });
        });
    }

    // Highlight matching text in suggestions
    highlightMatch(text) {
        if (typeof text !== 'string') {
            console.error('Invalid text type:', typeof text);
            return text;
        }
        const query = this.searchBar.value.trim().toLowerCase();
        const index = text.toLowerCase().indexOf(query);
        if (index === -1) return text;

        return text.slice(0, index) +
            `<strong>${text.slice(index, index + query.length)}</strong>` +
            text.slice(index + query.length);
    }

    // Handle keyboard navigation
    handleKeydown(e) {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
                this.showSuggestions();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
                this.showSuggestions();
                break;
            case 'Enter':
                if (this.selectedIndex >= 0) {
                    e.preventDefault();
                    this.selectSuggestion(this.selectedIndex);
                }
                break;
            case 'Escape':
                this.hideSuggestions();
                break;
        }
    }

    // Select a suggestion
    selectSuggestion(index) {
        const suggestion = this.suggestions[index];
        if (suggestion) {
            this.searchBar.value = suggestion.text;
            this.saveRecentSearch(suggestion.text);
            this.performSearch(suggestion.text);
        }
    }

    saveRecentSearch(query) {
        if (query) {
            try {
                this.saveLocalSearch(query);
                // sync with dropbox
                if (this.syncManager && this.syncManager.isAuthenticated) {
                    this.syncManager.syncSearchHistory();
                }
            } catch (error) {
                console.error('Failed to save recent search:', error);
            }
        }
    }

    // Fallback method if internet suggestions fail
    getFallbackSuggestions(query) {
        return this.recentSearches
            .filter(search => search.toLowerCase().includes(query.toLowerCase()))
            .map(search => ({
                text: search,
                type: 'recent',
                icon: '🕒'
            }));
    }

    // Remove a recent search
    removeRecentSearch(index) {
        const suggestion = this.suggestions[index];
        if (suggestion && suggestion.type === 'recent') {
            this.recentSearches = this.recentSearches.filter(s => s !== suggestion.text);
            localStorage.setItem('searchHistory', JSON.stringify(this.recentSearches));
            this.suggestions.splice(index, 1);
            this.showSuggestions();
            // sync with dropbox
            if (this.syncManager && this.syncManager.isAuthenticated) {
                this.syncManager.syncSearchHistory();
            }
        }
    }

    // Perform the search
    performSearch(query) {
        const searchEngineUrls = {
            duckduckgo: 'https://duckduckgo.com/?q=',
            google: 'https://www.google.com/search?q=',
            bing: 'https://www.bing.com/search?q='
        };

        window.location.href = searchEngineUrls[this.currentEngine] + encodeURIComponent(query);
    }

    // Hide suggestions
    hideSuggestions() {
        this.suggestionsContainer.style.display = 'none';
        this.selectedIndex = -1;
    }

    // Handle clicks outside the search area
    handleClickOutside(e) {
        if (!this.searchBar.contains(e.target) &&
            !this.suggestionsContainer.contains(e.target)) {
            this.hideSuggestions();
        }
    }

    // Update current search engine
    setSearchEngine(engine) {
        this.currentEngine = engine;
        if (this.searchBar.value.trim()) {
            this.handleInput();
        }
    }
}

let browserSync;
let suggestionsManager;

document.addEventListener('DOMContentLoaded', async function () {
    // Initialize BrowserSyncManager
    browserSync = new browserSyncManager();
    let syncInitialized = false;
    try {
        if (await browserSync.initialize()) {
            syncInitialized = true;
        } else {
            syncInitialized = true;
            console.log("Failed to initialize sync")
        }
    } catch (error) {
        console.warn('Failed to initialize sync:', error);
        // Continue without sync functionality
    }
    const searchBar = document.querySelector('.search-bar');
    const searchEngines = document.querySelector('.search-engines');
    const searchEngineFavicon = document.querySelector('.search-engine-favicon');
    const recentSearches = document.querySelector('.recent-searches');
    const mostVisited = document.querySelector('.most-visited');

    suggestionsManager = new SearchSuggestionsManager(syncInitialized ? browserSync : null);

    // Search engine functionality
    const searchEngineData = {
        duckduckgo: {
            favicon: 'https://duckduckgo.com/favicon.ico',
            url: 'https://duckduckgo.com/?q='
        },
        google: {
            favicon: 'https://www.google.com/favicon.ico',
            url: 'https://www.google.com/search?q='
        },
        bing: {
            favicon: 'https://www.bing.com/favicon.ico',
            url: 'https://www.bing.com/search?q='
        }
    };

    let currentEngine = 'duckduckgo';
    let searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');

    searchBar.addEventListener('focus', () => {
        searchEngines.style.display = 'block';
    });

    document.addEventListener('click', (e) => {
        if (!searchBar.contains(e.target) && !searchEngines.contains(e.target)) {
            searchEngines.style.display = 'none';
        }
        if (!searchBar.contains(e.target) && !recentSearches.contains(e.target)) {
            recentSearches.style.display = 'none';
        }
    });

    document.querySelectorAll('.search-engine-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.search-engine-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            currentEngine = option.dataset.engine;
            searchEngineFavicon.src = searchEngineData[currentEngine].favicon;
            suggestionsManager.setSearchEngine(currentEngine);
        });
    });

    // Search functionality
    searchBar.addEventListener('input', () => {
        const query = searchBar.value.trim();
        if (query) {
            const matchingSearches = searchHistory.filter(s =>
                s.toLowerCase().includes(query.toLowerCase())
            );

            if (matchingSearches.length > 0) {
                recentSearches.innerHTML = matchingSearches.map(search =>
                    `<div class="recent-search-item">${search}</div>`
                ).join('');
                recentSearches.style.display = 'block';
            } else {
                recentSearches.style.display = 'none';
            }
        } else {
            recentSearches.style.display = 'none';
        }
    });

    searchBar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchBar.value.trim();
            if (query) {
                // Use the SearchSuggestionsManager method instead of previous implementation
                suggestionsManager.saveRecentSearch(query);
                suggestionsManager.performSearch(query);
            }
        }
    });

    // Most visited sites functionality
    async function updateMostVisited() {
        const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');

        const sortedSites = sites.sort((a, b) => (b.pinned || 0) - (a.pinned || 0));

        mostVisited.innerHTML = sortedSites.map((site, index) => `
            <div class="site-item-container">
                <div class="site-item ${site.pinned ? 'pinned' : ''}" title="${site.title}" draggable="true" data-index="${index}">
                    <img src="${site.favicon}" alt="${site.title}" class="site-favicon" onclick="window.location.href='${site.url}'">
                    <div class="site-actions">
                        <button class="site-action-btn remove-site" title="Remove">❌</button>
                    </div>
                </div>
                <div class="site-title">${site.title}</div>
            </div>
        `).join('');

        // Add the "+" button at the end
        mostVisited.innerHTML += `
            <button class="add-favorite-site" title="Add a new site">
                <i class="fas fa-plus"></i>
            </button>
        `;

        document.querySelectorAll('.remove-site').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.closest('.site-item').dataset.index);
                removeSite(index);
            });
        });

        // Add event listeners
        addDragAndDropListeners();

        document.querySelector('.add-favorite-site').addEventListener('click', addNewSite);

    }

    // updateMostVisited();

    async function removeSite(index) {
        try {
            const sitesLocal = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            sitesLocal.splice(index, 1);
            localStorage.setItem('mostVisited', JSON.stringify(sitesLocal));
            console.log('Favorite sites removed successfully');
            // sync with dropbox
            if (syncInitialized) {
                await browserSync.syncFavorites();
            }
        } catch (error) {
            console.error('Failed to remove site:', error);
        }
        updateMostVisited();
    }

    function addDragAndDropListeners() {
        const siteItems = document.querySelectorAll('.site-item-container');
        let draggedItem = null;
        let draggedItemIndex = null;
        let placeholder = null;

        siteItems.forEach(item => {
            // Prevent drag from starting on buttons or images
            item.querySelector('.site-favicon').addEventListener('mousedown', e => e.stopPropagation());
            item.querySelector('.site-actions').addEventListener('mousedown', e => e.stopPropagation());

            item.addEventListener('dragstart', function (e) {
                // draggedElement = item;
                // e.dataTransfer.effectAllowed = 'move';
                // draggedElement.classList.add('dragging');

                draggedItem = this;
                draggedItemIndex = parseInt(this.dataset.index);

                // Create and style placeholder
                placeholder = this.cloneNode(true);
                placeholder.classList.add('placeholder');
                placeholder.style.opacity = '0.3';

                // Style dragged item
                setTimeout(() => {
                    this.style.opacity = '0.5';
                    this.classList.add('dragging');
                }, 0);

                // Set drag image to transparent
                const transparent = document.createElement('div');
                e.dataTransfer.setDragImage(transparent, 0, 0);
            });

            item.addEventListener('dragover', function (e) {
                // e.preventDefault();
                // e.dataTransfer.dropEffect = 'move';
                // const currentHoveredElement = e.target.closest('.site-item');
                // if (currentHoveredElement && currentHoveredElement !== draggedElement) {
                //     mostVisited.insertBefore(draggedElement, currentHoveredElement.nextSibling);
                // }

                e.preventDefault();
                if (this === draggedItem) return;

                const rect = this.getBoundingClientRect();
                const mouseX = e.clientX;
                const itemCenterX = rect.left + (rect.width / 2);

                if (mouseX < itemCenterX) {
                    if (this.previousElementSibling !== draggedItem) {
                        this.parentNode.insertBefore(draggedItem, this);
                    }
                } else {
                    if (this.nextElementSibling !== draggedItem) {
                        this.parentNode.insertBefore(draggedItem, this.nextElementSibling);
                    }
                }
            });

            // item.addEventListener('drop', () => {
            //     const updatedOrder = Array.from(mostVisited.querySelectorAll('.site-item')).map(el => {
            //         return JSON.parse(localStorage.getItem('mostVisited') || '[]')[el.dataset.index];
            //     });

            //     localStorage.setItem('mostVisited', JSON.stringify(updatedOrder));
            //     updateMostVisited();
            // });

            item.addEventListener('dragend', function () {
                // draggedElement.classList.remove('dragging');
                // draggedElement = null;

                this.style.opacity = '1';
                this.classList.remove('dragging');
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.removeChild(placeholder);
                }
                updateSiteOrder();
            });

            // Touch events for mobile
            item.addEventListener('touchstart', function (e) {
                if (e.target.closest('.site-actions')) return;

                draggedItem = this;
                draggedItemIndex = parseInt(this.dataset.index);
                this.classList.add('dragging');

                const touch = e.touches[0];
                const rect = this.getBoundingClientRect();
                this.touchOffset = {
                    x: touch.clientX - rect.left,
                    y: touch.clientY - rect.top
                };
            });

            item.addEventListener('touchmove', function (e) {
                if (!draggedItem) return;
                e.preventDefault();

                const touch = e.touches[0];
                const x = touch.clientX - this.touchOffset.x;
                const y = touch.clientY - this.touchOffset.y;

                draggedItem.style.position = 'fixed';
                draggedItem.style.left = x + 'px';
                draggedItem.style.top = y + 'px';

                // Find the element we're hovering over
                const elementsBelow = document.elementsFromPoint(touch.clientX, touch.clientY);
                const hoverElement = elementsBelow.find(el =>
                    el.classList.contains('site-item') && el !== draggedItem
                );

                if (hoverElement) {
                    const rect = hoverElement.getBoundingClientRect();
                    if (touch.clientX < rect.left + (rect.width / 2)) {
                        hoverElement.parentNode.insertBefore(draggedItem, hoverElement);
                    } else {
                        hoverElement.parentNode.insertBefore(draggedItem, hoverElement.nextElementSibling);
                    }
                }
            });

            item.addEventListener('touchend', function () {
                if (!draggedItem) return;

                draggedItem.style.position = '';
                draggedItem.style.left = '';
                draggedItem.style.top = '';
                draggedItem.classList.remove('dragging');

                updateSiteOrder();
                draggedItem = null;
            });
        });
    }

    async function addNewSite() {
        const url = prompt('Enter the website URL:');
        if (url) {
            try {
                const siteDomain = new URL(url).hostname;
                const newSite = {
                    title: siteDomain.replace(/^www\./, ''),
                    favicon: `https://${siteDomain}/favicon.ico`,
                    url: url,
                    pinned: false,
                    lastModified: Date.now()
                };

                const currentSites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
                currentSites.push(newSite);
                localStorage.setItem('mostVisited', JSON.stringify(currentSites));
                // sync with dropbox
                if (syncInitialized) {
                    await browserSync.syncFavorites();
                }
                updateMostVisited();
            } catch (error) {
                console.error('Failed to add new site:', error);
                alert('Please enter a valid URL');
            }
        }
    }

    async function updateSiteOrder() {
        const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
        const newOrder = Array.from(mostVisited.querySelectorAll('.site-item')).map(item =>
            sites[parseInt(item.dataset.index)]
        ).filter(Boolean);
        localStorage.setItem('mostVisited', JSON.stringify(newOrder));
        // sync with dropbox
        if (syncInitialized) {
            await browserSync.syncFavorites();
        }
        updateMostVisited();

    }

    // function updateLocalSiteOrder(newOrder) {
    //     const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
    //     const reorderedSites = newOrder.map(index => sites[index]).filter(Boolean);
    //     localStorage.setItem('mostVisited', JSON.stringify(reorderedSites));
    // }

    // let draggedIndex = null;

    // function dragStart(e) {
    //     draggedIndex = parseInt(e.target.dataset.index);
    //     e.dataTransfer.setData('text/plain', 'dragged');
    // }

    // function dragOver(e) {
    //     e.preventDefault();
    // }

    // function drop(e) {
    //     e.preventDefault();
    //     const targetIndex = parseInt(e.target.closest('.site-item').dataset.index);

    //     if (draggedIndex !== null && draggedIndex !== targetIndex) {
    //         const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
    //         const draggedSite = sites.splice(draggedIndex, 1)[0];
    //         sites.splice(targetIndex, 0, draggedSite);
    //         localStorage.setItem('mostVisited', JSON.stringify(sites));
    //         updateMostVisited();
    //     }
    // }

    // enableTouchReorder();
    updateMostVisited();

    // Set up periodic sync if needed
    if (syncInitialized) {
        setInterval(() => browserSync.syncData(), 30000); // Sync every 5 minutes
    }

});

