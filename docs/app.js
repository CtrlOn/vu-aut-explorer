// Global imports check
const { Graph } = window.graphology;
const { layoutForceAtlas2 } = window.graphologyLibrary;

// Base API URL Configuration
// For local development, use relative paths (empty string).
// For production deployments (e.g., GitHub Pages), replace the placeholder with your hosted backend proxy URL.
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : ''; // e.g. 'https://vu-authors-explorer-api.onrender.com'

// Application State
const state = {
    graph: null,
    sigmaInstance: null,
    exploredAuthors: new Set(), // Set of authors whose co-authors have been loaded
    activeAuthor: null,         // Author name currently shown in the details panel
    publicationsCache: {},      // Caches full details of authors (publications, verified co-authors)
    physicsRunning: true,       // Controls whether force layout simulation is active
    draggedNode: null,          // Node currently being dragged
    isDragging: false,          // Dragging state
    isHovering: null,           // Node currently hovered
    
    // Force layout simulation tuning variables
    layoutSettings: {
        gravity: 0.01,
        scalingRatio: 12,
        slowDown: 15,
        strongGravityMode: false,
        barnesHutOptimize: false,
        adjustSizes: false,
    }
};

// Initialize Application on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    initGraph();
    setupEventListeners();
    setupGraphInteractions();
    animateLayout();
});

// Initialize Graphology & Sigma.js
function initGraph() {
    // 1. Create a graph instance
    state.graph = new Graph({ type: 'undirected' });

    // 2. Instantiate Sigma.js renderer
    const container = document.getElementById('sigmaContainer');
    state.sigmaInstance = new Sigma(state.graph, container, {
        allowBackgroundClicks: true,
        renderEdgeLabels: false,
        labelFont: 'Inter, sans-serif',
        labelWeight: '500',
        labelSize: 12,
        labelColor: { color: '#f3f3f6' },
        defaultNodeType: 'circle',
        defaultEdgeType: 'line',
    });

    // Custom reducers for hovering effects and highlighting
    state.sigmaInstance.setSetting("nodeReducer", (node, data) => {
        const res = { ...data };

        // Color based on role
        if (state.exploredAuthors.has(node)) {
            res.color = '#9d4edd'; // Explored (seed/main) node - Purple
        } else {
            res.color = '#00b4d8'; // Leaf node (co-author) - Cyan
        }

        // Highlight active clicked author
        if (state.activeAuthor === node) {
            res.color = '#ff007f'; // Active - Neon Pink
            res.highlighted = true;
        }

        // Dim nodes when another node is hovered
        if (state.isHovering && state.isHovering !== node && !state.graph.areNeighbors(state.isHovering, node)) {
            res.label = undefined;
            res.color = '#252538';
        }

        return res;
    });

    state.sigmaInstance.setSetting("edgeReducer", (edge, data) => {
        const res = { ...data };
        res.color = 'rgba(255, 255, 255, 0.08)';

        // Highlight edges connected to the hovered node
        if (state.isHovering) {
            if (state.graph.hasExtremity(edge, state.isHovering)) {
                res.color = 'rgba(0, 180, 216, 0.6)';
                res.size = 2;
            } else {
                res.color = 'rgba(255, 255, 255, 0.02)';
            }
        }

        // Highlight edges connected to the active clicked author
        if (state.activeAuthor && state.graph.hasExtremity(edge, state.activeAuthor)) {
            res.color = 'rgba(157, 78, 221, 0.4)';
        }

        return res;
    });
}

// Setup Standard Page Controls
function setupEventListeners() {
    const searchInput = document.getElementById('authorSearchInput');
    const searchBtn = document.getElementById('addAuthorBtn');
    const closeDetailsBtn = document.getElementById('closeDetailsBtn');
    const pubSearchInput = document.getElementById('pubSearchInput');
    
    // Zoom Buttons
    document.getElementById('zoomInBtn').addEventListener('click', () => {
        state.sigmaInstance.getCamera().animatedZoom(1.5);
    });
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
        state.sigmaInstance.getCamera().animatedZoom(0.6);
    });
    document.getElementById('resetZoomBtn').addEventListener('click', () => {
        state.sigmaInstance.getCamera().animatedReset();
    });

    // Physics Toggle
    const physicsBtn = document.getElementById('physicsBtn');
    physicsBtn.addEventListener('click', () => {
        state.physicsRunning = !state.physicsRunning;
        physicsBtn.classList.toggle('active', state.physicsRunning);
        if (state.physicsRunning) {
            physicsBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        } else {
            physicsBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        }
    });

    // Trigger Search on Button click or Enter
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Close Details Panel
    closeDetailsBtn.addEventListener('click', () => {
        document.getElementById('detailsPanel').classList.add('closed');
        state.activeAuthor = null;
        state.sigmaInstance.refresh();
    });

    // Filter publications in sidebar details
    pubSearchInput.addEventListener('input', (e) => {
        filterPublicationsList(e.target.value);
    });

    // Toggle Debug Panel
    const debugToggleBtn = document.getElementById('debugToggleBtn');
    const debugPanel = document.getElementById('debugPanel');
    const closeDebugBtn = document.getElementById('closeDebugBtn');
    
    debugToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        debugPanel.classList.toggle('hidden');
    });

    closeDebugBtn.addEventListener('click', () => {
        debugPanel.classList.add('hidden');
    });

    // Close debug panel on clicking outside it
    document.addEventListener('click', (e) => {
        if (debugPanel && !debugPanel.classList.contains('hidden') && !debugPanel.contains(e.target) && e.target !== debugToggleBtn && !debugToggleBtn.contains(e.target)) {
            debugPanel.classList.add('hidden');
        }
    });

    // Handle Force Sliders
    const gravitySlider = document.getElementById('gravitySlider');
    const gravityVal = document.getElementById('gravityVal');
    gravitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.layoutSettings.gravity = val;
        gravityVal.textContent = val.toFixed(3);
    });

    const scalingSlider = document.getElementById('scalingSlider');
    const scalingVal = document.getElementById('scalingVal');
    scalingSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.layoutSettings.scalingRatio = val;
        scalingVal.textContent = val.toFixed(1);
    });

    const slowDownSlider = document.getElementById('slowDownSlider');
    const slowDownVal = document.getElementById('slowDownVal');
    slowDownSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.layoutSettings.slowDown = val;
        slowDownVal.textContent = val.toFixed(1);
    });

    // Handle Checkboxes
    const strongGravityCheckbox = document.getElementById('strongGravityCheckbox');
    strongGravityCheckbox.addEventListener('change', (e) => {
        state.layoutSettings.strongGravityMode = e.target.checked;
    });

    const barnesHutCheckbox = document.getElementById('barnesHutCheckbox');
    barnesHutCheckbox.addEventListener('change', (e) => {
        state.layoutSettings.barnesHutOptimize = e.target.checked;
    });

    const adjustSizesCheckbox = document.getElementById('adjustSizesCheckbox');
    adjustSizesCheckbox.addEventListener('change', (e) => {
        state.layoutSettings.adjustSizes = e.target.checked;
    });

    // Handle Reset Button
    const resetDebugBtn = document.getElementById('resetDebugBtn');
    resetDebugBtn.addEventListener('click', () => {
        // Reset values in state
        state.layoutSettings.gravity = 0.01;
        state.layoutSettings.scalingRatio = 12;
        state.layoutSettings.slowDown = 15;
        state.layoutSettings.strongGravityMode = false;
        state.layoutSettings.barnesHutOptimize = false;
        state.layoutSettings.adjustSizes = false;

        // Reset UI inputs
        gravitySlider.value = 0.01;
        gravityVal.textContent = '0.010';
        
        scalingSlider.value = 12;
        scalingVal.textContent = '12.0';
        
        slowDownSlider.value = 15;
        slowDownVal.textContent = '15.0';

        strongGravityCheckbox.checked = false;
        barnesHutCheckbox.checked = false;
        adjustSizesCheckbox.checked = false;
        
        // Trigger a temporary animation acceleration
        triggerTemporaryPhysics();
    });
}

// Handle Node drag & hover events
function setupGraphInteractions() {
    const tooltip = document.getElementById('nodeTooltip');

    // Hover Node - Display Tooltip and Dim non-neighbors
    state.sigmaInstance.on('enterNode', (e) => {
        state.isHovering = e.node;
        const nodeName = e.node;
        const degree = state.graph.degree(nodeName);
        
        // Setup tooltip content
        tooltip.innerHTML = `
            <strong>${nodeName}</strong><br/>
            <i class="fa-solid fa-link" style="color: var(--accent-secondary)"></i> ${degree} connections
        `;
        tooltip.classList.remove('hidden');
        state.sigmaInstance.refresh();
    });

    state.sigmaInstance.on('leaveNode', () => {
        state.isHovering = null;
        tooltip.classList.add('hidden');
        state.sigmaInstance.refresh();
    });

    // Mouse drag nodes behavior
    state.sigmaInstance.on('downNode', (e) => {
        state.isDragging = true;
        state.draggedNode = e.node;
        state.sigmaInstance.getMouseCaptor().preventNextClick = true;
    });

    state.sigmaInstance.getMouseCaptor().on('mousemove', (e) => {
        if (!state.isDragging || !state.draggedNode) return;
        
        const pos = state.sigmaInstance.viewportToGraph(e);
        state.graph.setNodeAttribute(state.draggedNode, 'x', pos.x);
        state.graph.setNodeAttribute(state.draggedNode, 'y', pos.y);
        
        // Refresh tooltip position
        tooltip.style.left = `${e.x + 15}px`;
        tooltip.style.top = `${e.y + 15}px`;
        
        e.preventSigmaDefault();
    });

    // Track mouse move for general tooltip position tracking
    container_element().addEventListener('mousemove', (e) => {
        if (!state.isHovering) return;
        const rect = container_element().getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 15}px`;
        tooltip.style.top = `${e.clientY - rect.top + 15}px`;
    });

    state.sigmaInstance.getMouseCaptor().on('mouseup', () => {
        if (state.isDragging) {
            state.isDragging = false;
            state.draggedNode = null;
        }
    });

    // Node click action: Select and click-expand
    state.sigmaInstance.on('clickNode', (e) => {
        const nodeName = e.node;
        selectAuthor(nodeName);
    });

    // Background click resets active node
    state.sigmaInstance.on('clickStage', () => {
        if (state.isDragging) return;
        // Do not close panel on background click to preserve readability, 
        // but we can un-highlight active node if desired
    });
}

// Get the actual Sigma HTML container safely
function container_element() {
    return document.getElementById('sigmaContainer');
}

// Physics layout engine simulation loop
function animateLayout() {
    if (state.physicsRunning && state.graph && state.graph.order > 0 && !state.isDragging) {
        layoutForceAtlas2.assign(state.graph, {
            iterations: 1,
            settings: {
                gravity: state.layoutSettings.gravity,
                scalingRatio: state.layoutSettings.scalingRatio,
                slowDown: state.layoutSettings.slowDown,
                strongGravityMode: state.layoutSettings.strongGravityMode,
                barnesHutOptimize: state.layoutSettings.barnesHutOptimize || (state.graph.order > 50),
                adjustSizes: state.layoutSettings.adjustSizes
            }
        });
        state.sigmaInstance.refresh();
    }
    requestAnimationFrame(animateLayout);
}

// Triggers layout simulation explicitly for a short burst
function triggerTemporaryPhysics(durationMs = 2500) {
    const physicsBtn = document.getElementById('physicsBtn');
    if (!state.physicsRunning) {
        state.physicsRunning = true;
        physicsBtn.classList.add('active');
        physicsBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        
        setTimeout(() => {
            state.physicsRunning = false;
            physicsBtn.classList.remove('active');
            physicsBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        }, durationMs);
    }
}

// Search & add a fresh author node to the graph
async function handleSearch() {
    const searchInput = document.getElementById('authorSearchInput');
    const name = searchInput.value.trim();
    if (!name) return;

    showStatus('Checking author validity...', 'info');
    showLoader(true, `Verifying author "${name}"...`);

    try {
        let exists = false;
        
        if (isServerlessMode()) {
            const html = await clientFetchHtml(name);
            exists = clientParsePageExists(html);
        } else {
            const response = await fetch(`${API_BASE}/api/search?name=${encodeURIComponent(name)}`);
            const result = await response.json();
            exists = result.exists;
        }

        if (exists) {
            hideWelcomeOverlay();
            
            // Add to graph if not present
            if (!state.graph.hasNode(name)) {
                // Determine a nice insertion position
                let x = 0, y = 0;
                if (state.graph.order > 0) {
                    // Place slightly offset from current center of coordinates
                    const angle = Math.random() * Math.PI * 2;
                    const r = 50 + Math.random() * 50;
                    x = Math.cos(angle) * r;
                    y = Math.sin(angle) * r;
                }
                
                state.graph.addNode(name, {
                    label: name,
                    x: x,
                    y: y,
                    size: 15,
                    color: '#9d4edd'
                });
                
                showStatus(`Added author "${name}" to graph. Click node to expand!`, 'success');
            } else {
                showStatus(`Author "${name}" is already on the graph.`, 'info');
            }

            // Select node and center camera
            selectAuthor(name);
            centerCameraOnNode(name);
            updateStats();
        } else {
            showStatus(`Author "${name}" not found or has no publications in eLABa.`, 'error');
        }
    } catch (err) {
        console.error('Search failed:', err);
        showStatus('Search failed. Server error.', 'error');
    } finally {
        showLoader(false);
    }
}

// Select an author, fetch co-authors + publications, and open sidebar details
async function selectAuthor(authorName) {
    state.activeAuthor = authorName;
    state.sigmaInstance.refresh();
    
    showLoader(true, `Loading details for ${authorName}...`);

    try {
        let details = state.publicationsCache[authorName];

        if (!details) {
            if (isServerlessMode()) {
                // Fetch & parse HTML directly
                const html = await clientFetchHtml(authorName);
                details = clientParsePublicationsAndCoauthors(html, authorName);
                
                if (details.exists) {
                    showLoader(true, `Verifying ${details.coauthors.length} co-authors...`);
                    
                    // Verify coauthors in parallel with a concurrency limit of 5
                    const verificationTasks = details.coauthors.map(coauthor => async () => {
                        try {
                            const coauthorHtml = await clientFetchHtml(coauthor);
                            const exists = clientParsePageExists(coauthorHtml);
                            return { name: coauthor, exists };
                        } catch (err) {
                            console.error(`Failed verifying co-author ${coauthor}:`, err);
                            return { name: coauthor, exists: false };
                        }
                    });

                    const verifications = await clientLimitConcurrency(verificationTasks, 5);
                    details.coauthors = verifications
                        .filter(v => v.exists)
                        .map(v => v.name);
                    
                    state.publicationsCache[authorName] = details;
                }
            } else {
                // Fetch from backend
                const response = await fetch(`${API_BASE}/api/author?name=${encodeURIComponent(authorName)}`);
                details = await response.json();
                
                if (details.exists) {
                    state.publicationsCache[authorName] = details;
                }
            }
        }

        if (details && details.exists) {
            // 1. Expand the network (add co-authors and links)
            expandAuthorNetwork(authorName, details.coauthors);
            
            // 2. Render Details panel
            renderDetailsPanel(details);
            
            // 3. Mark in explored Set and add to explored list in sidebar
            state.exploredAuthors.add(authorName);
            updateExploredListUI();
            
            hideWelcomeOverlay();
        } else {
            showStatus(`Could not load details for ${authorName}.`, 'error');
        }
    } catch (err) {
        console.error('Failed to select author:', err);
        showStatus('Failed to load author details.', 'error');
    } finally {
        showLoader(false);
        updateStats();
        state.sigmaInstance.refresh();
    }
}

// Expand graph: Adds co-authors around parent and links them
function expandAuthorNetwork(parentName, coauthors) {
    if (!state.graph.hasNode(parentName)) return;

    const parentAttr = state.graph.getNodeAttributes(parentName);
    const parentX = parentAttr.x || 0;
    const parentY = parentAttr.y || 0;

    // We increase node size based on connections/degree
    state.graph.setNodeAttribute(parentName, 'size', 15 + Math.min(coauthors.length * 0.5, 15));

    coauthors.forEach((coauthor, index) => {
        // 1. Add co-author node if not exists
        if (!state.graph.hasNode(coauthor)) {
            // Position them in a clean ring layout around the parent to prevent immediate overlap
            const angle = (index / coauthors.length) * Math.PI * 2 + (Math.random() * 0.5);
            const radius = 40 + Math.random() * 30;
            const x = parentX + Math.cos(angle) * radius;
            const y = parentY + Math.sin(angle) * radius;

            state.graph.addNode(coauthor, {
                label: coauthor,
                x: x,
                y: y,
                size: 8,
                color: '#00b4d8'
            });
        }

        // 2. Add connection edge if not exists
        if (!state.graph.hasEdge(parentName, coauthor)) {
            state.graph.addEdge(parentName, coauthor, {
                size: 1.5,
                color: 'rgba(255, 255, 255, 0.08)'
            });
        }
    });

    // Make sure nodes size and degree-related styles are balanced
    state.graph.forEachNode(node => {
        const deg = state.graph.degree(node);
        const isExplored = state.exploredAuthors.has(node);
        const baseSize = isExplored ? 14 : 8;
        state.graph.setNodeAttribute(node, 'size', baseSize + Math.min(deg * 0.4, 12));
    });

    // Run physics simulation briefly to settle the new network expansion
    triggerTemporaryPhysics();
}

// Render right side details panel content
function renderDetailsPanel(details) {
    const panel = document.getElementById('detailsPanel');
    const nameEl = document.getElementById('detailsAuthorName');
    const elabaLinkEl = document.getElementById('detailsElabaLink');
    const pubCountEl = document.getElementById('detailsPubCount');
    const coauthorCountEl = document.getElementById('detailsCoauthorCount');
    const pubSearchInput = document.getElementById('pubSearchInput');
    
    nameEl.textContent = details.name;
    elabaLinkEl.href = `https://elaba.mb.vu.lt/fsf/?aut=${encodeURIComponent(details.name)}`;
    pubCountEl.textContent = details.publications.length;
    coauthorCountEl.textContent = details.coauthors.length;
    pubSearchInput.value = ''; // Reset filter

    // Save full list of publications on the element for filtering
    const container = document.getElementById('publicationsContainer');
    container.innerHTML = '';

    if (details.publications.length === 0) {
        container.innerHTML = '<div class="empty-list-msg">No publications details parsed.</div>';
    } else {
        details.publications.forEach(pub => {
            const pubDiv = document.createElement('div');
            pubDiv.className = 'pub-item';
            pubDiv.dataset.text = `${pub.authors.join(' ')} ${pub.details}`.toLowerCase();

            // Construct highlighted authors paragraph
            const authorsPara = document.createElement('p');
            authorsPara.className = 'pub-authors';
            
            pub.authors.forEach((author, idx) => {
                const isCoauthor = details.coauthors.includes(author) || author === details.name;
                const authorSpan = document.createElement('span');
                authorSpan.textContent = author;
                
                if (isCoauthor && author !== details.name) {
                    authorSpan.className = 'pub-author-highlight';
                    authorSpan.title = `Click to view ${author}`;
                    authorSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (state.graph.hasNode(author)) {
                            selectAuthor(author);
                            centerCameraOnNode(author);
                        } else {
                            // If they are valid but not currently added, add them!
                            quickStart(author);
                        }
                    });
                }
                
                authorsPara.appendChild(authorSpan);
                if (idx < pub.authors.length - 1) {
                    authorsPara.appendChild(document.createTextNode('; '));
                }
            });

            // Construct details paragraph
            const detailsPara = document.createElement('p');
            detailsPara.className = 'pub-details';
            detailsPara.innerHTML = formatUrlsInText(pub.details);

            // Construct badge
            const numSpan = document.createElement('span');
            numSpan.className = 'pub-num';
            numSpan.textContent = `Pub #${pub.id}`;

            pubDiv.appendChild(numSpan);
            pubDiv.appendChild(authorsPara);
            pubDiv.appendChild(detailsPara);
            container.appendChild(pubDiv);
        });
    }

    // Slide open the panel
    panel.classList.remove('closed');
}

// Simple text URL formatter
function formatUrlsInText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    return text.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" class="details-url">${url}</a>`;
    });
}

// Filter publications list locally
function filterPublicationsList(query) {
    const cleanQuery = query.toLowerCase().trim();
    const items = document.querySelectorAll('#publicationsContainer .pub-item');
    items.forEach(item => {
        const match = item.dataset.text.includes(cleanQuery);
        item.style.display = match ? 'block' : 'none';
    });
}

// Update left-sidebar explored authors list
function updateExploredListUI() {
    const list = document.getElementById('exploredList');
    list.innerHTML = '';

    if (state.exploredAuthors.size === 0) {
        list.innerHTML = '<li class="empty-list-msg">No authors explored yet. Use the search bar above to get started.</li>';
        return;
    }

    Array.from(state.exploredAuthors).sort().forEach(author => {
        const li = document.createElement('li');
        li.className = `explored-item ${state.activeAuthor === author ? 'active' : ''}`;
        
        // Handle list selection
        li.addEventListener('click', () => {
            selectAuthor(author);
            centerCameraOnNode(author);
        });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'item-name';
        nameSpan.textContent = author;
        nameSpan.title = author;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'item-actions';

        // Delete node button
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon delete';
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        delBtn.title = `Remove ${author} node`;
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeAuthorFromGraph(author);
        });

        actionsDiv.appendChild(delBtn);
        li.appendChild(nameSpan);
        li.appendChild(actionsDiv);
        list.appendChild(li);
    });
}

// Center the Sigma.js camera viewport on a specific node
function centerCameraOnNode(nodeId) {
    if (!state.graph.hasNode(nodeId)) return;
    const nodeAttr = state.graph.getNodeAttributes(nodeId);
    
    state.sigmaInstance.getCamera().animate({
        x: nodeAttr.x,
        y: nodeAttr.y,
        ratio: 0.65
    }, {
        duration: 800
    });
}

// Remove an author node and balance graph degree sizes
function removeAuthorFromGraph(authorName) {
    if (!state.graph.hasNode(authorName)) return;

    // 1. Remove from explored list
    state.exploredAuthors.delete(authorName);
    
    // 2. Remove the actual node (links will be deleted automatically by Graphology)
    state.graph.dropNode(authorName);

    // 3. Clean up orphans (nodes with degree 0)
    state.graph.forEachNode(node => {
        if (state.graph.degree(node) === 0) {
            state.graph.dropNode(node);
        }
    });

    // 4. Update Node sizes
    state.graph.forEachNode(node => {
        const deg = state.graph.degree(node);
        const isExplored = state.exploredAuthors.has(node);
        const baseSize = isExplored ? 14 : 8;
        state.graph.setNodeAttribute(node, 'size', baseSize + Math.min(deg * 0.4, 12));
    });

    // 5. Un-highlight if deleted
    if (state.activeAuthor === authorName) {
        state.activeAuthor = null;
        document.getElementById('detailsPanel').classList.add('closed');
    }

    showStatus(`Removed "${authorName}" from the network.`, 'info');
    updateExploredListUI();
    updateStats();
    state.sigmaInstance.refresh();
}

// Helper to update network counters in sidebar
function updateStats() {
    document.getElementById('nodeCount').textContent = state.graph.order;
    document.getElementById('edgeCount').textContent = state.graph.size;
}

// Helper status display
function showStatus(message, type = 'info') {
    const statusMsg = document.getElementById('statusMessage');
    statusMsg.className = `status-message ${type}`;
    statusMsg.textContent = message;
    
    // Auto-fade status messages after 5 seconds if not error
    if (type !== 'error') {
        setTimeout(() => {
            if (statusMsg.textContent === message) {
                statusMsg.className = 'status-message';
                statusMsg.textContent = '';
            }
        }, 5000);
    }
}

// Helper loaders
function showLoader(show, text = 'Loading...') {
    const overlay = document.getElementById('loaderOverlay');
    const textEl = document.getElementById('loaderText');
    if (show) {
        textEl.textContent = text;
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

// Welcome panel helper
function hideWelcomeOverlay() {
    const welcome = document.getElementById('welcomeOverlay');
    if (welcome && !welcome.classList.contains('hidden')) {
        welcome.classList.add('hidden');
    }
}

// ============================================================================
// SERVERLESS FALLBACK ENGINE (For zero-config deployment on GitHub Pages)
// ============================================================================

function isServerlessMode() {
    // True if API_BASE is blank and we are running outside localhost/127.0.0.1
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return !API_BASE && !isLocal;
}

function clientNormalizeName(name) {
    if (!name) return '';
    const parts = name.split(',');
    if (parts.length === 2) {
        return `${parts[1].trim()} ${parts[0].trim()}`;
    }
    return name.trim();
}

function clientParsePageExists(html) {
    if (!html) return false;
    return html.toLowerCase().includes('<table') && html.toLowerCase().includes('<tr>');
}

function clientParsePublicationsAndCoauthors(html, currentAuthorName) {
    const result = {
        exists: false,
        coauthors: [],
        publications: []
    };

    if (!clientParsePageExists(html)) {
        return result;
    }

    result.exists = true;
    
    // Exact same regex parsing as server.js
    const rowRegex = /<tr>\s*<td>\d+<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    const coauthorSet = new Set();
    const normalizedCurrentAuthor = currentAuthorName.toLowerCase().trim();
    let rowMatch;
    let pubCount = 0;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        pubCount++;
        const pubHtml = rowMatch[1].trim();
        const authorsInRow = [];
        let authorMatch;
        const freshAuthorRegex = /<author[^>]*>([^<]+)<\/author>/gi;
        
        while ((authorMatch = freshAuthorRegex.exec(pubHtml)) !== null) {
            const rawName = authorMatch[1].trim();
            const normName = clientNormalizeName(rawName);
            authorsInRow.push(normName);
            
            if (normName.toLowerCase().trim() !== normalizedCurrentAuthor) {
                coauthorSet.add(normName);
            }
        }

        let detailsText = pubHtml.replace(/<author[^>]*>[^<]+<\/author>/gi, '');
        detailsText = detailsText.replace(/^[\s;.,]+/g, '').trim();
        
        result.publications.push({
            id: pubCount,
            authors: authorsInRow,
            details: detailsText
        });
    }

    result.coauthors = Array.from(coauthorSet);
    return result;
}

const clientHtmlCache = {};

async function clientFetchHtml(authorName) {
    if (clientHtmlCache[authorName]) {
        return clientHtmlCache[authorName];
    }
    
    // Use api.allorigins.win as a free, reliable, CORS-transparent proxy
    const targetUrl = `https://elaba.mb.vu.lt/fsf/?aut=${encodeURIComponent(authorName)}`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
        throw new Error(`Public CORS proxy returned error: ${response.status}`);
    }
    const data = await response.json();
    const html = data.contents || '';
    
    clientHtmlCache[authorName] = html;
    return html;
}

async function clientLimitConcurrency(tasks, limit) {
    const results = [];
    const executing = [];
    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);
        if (limit <= tasks.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

