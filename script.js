// --- Global State ---
let lives = []; 
let currentTab = 'all'; 

// Updated default model
let appSettings = { apiKey: "", model: "openai/gpt-oss-120b", yearsPerTurn: 1, narrativeLength: "2p", volatility: 3 };
const volatilityLabels = ["Peaceful", "Calm", "Classic", "Dramatic", "Chaotic"];

// --- DOM Elements ---
const DOM = {
    livesGrid: document.getElementById('livesGrid'), emptyState: document.getElementById('emptyState'),
    statsSubtitle: document.getElementById('statsSubtitle'), newLifeBtn: document.getElementById('newLifeBtn'),
    tabButtons: document.querySelectorAll('.nav-link[data-tab]'),
    welcome: {
        modal: document.getElementById('apiKeyModal'), step1: document.getElementById('welcomeStep1'),
        step2: document.getElementById('welcomeStep2'), input: document.getElementById('welcomeApiKey'),
        modelSelect: document.getElementById('welcomeModel'), status: document.getElementById('welcomeApiStatus'),
        verifyBtn: document.getElementById('welcomeVerifyBtn'), testInput: document.getElementById('welcomeTestInput'),
        testBtn: document.getElementById('welcomeTestBtn'), testOutput: document.getElementById('welcomeTestOutput'),
        finalActions: document.getElementById('welcomeFinalActions'), worksBtn: document.getElementById('worksBtn'),
        doesntWorkBtn: document.getElementById('doesntWorkBtn')
    },
    settings: {
        btn: document.getElementById('settingsBtn'), modal: document.getElementById('settingsModal'),
        closeBtn: document.getElementById('closeSettingsBtn'), cancelBtn: document.getElementById('cancelSettingsBtn'),
        saveBtn: document.getElementById('saveSettingsBtn'), yearsSlider: document.getElementById('yearsPerTurn'),
        yearsValText: document.getElementById('yearsVal'), volatilitySlider: document.getElementById('eventVolatility'),
        volatilityValText: document.getElementById('volatilityVal'), narrativeSelect: document.getElementById('narrativeLength'),
        narrativeHelpText: document.getElementById('narrativeHelpText'), apiKeyInput: document.getElementById('settingsApiKey'),
        modelSelect: document.getElementById('settingsModel'), apiStatus: document.getElementById('settingsApiStatus'), 
        testApiBtn: document.getElementById('testApiKeyBtn'), exportBtn: document.getElementById('exportDataBtn'), 
        importBtn: document.getElementById('importDataBtn'), importFile: document.getElementById('importFile'), 
        wipeBtn: document.getElementById('wipeDataBtn')
    }
};

// --- Storage & Init ---
function loadData() {
    const savedLives = localStorage.getItem('ailife_lives'); const savedSettings = localStorage.getItem('ailife_settings');
    if (savedLives) lives = JSON.parse(savedLives); if (savedSettings) appSettings = JSON.parse(savedSettings);
}
function saveData() { localStorage.setItem('ailife_lives', JSON.stringify(lives)); localStorage.setItem('ailife_settings', JSON.stringify(appSettings)); }

function init() {
    loadData(); if (!appSettings.apiKey) DOM.welcome.modal.classList.add('show');
    renderGrid(); updateStats(); updateNarrativeOptions(); 
}

// --- API Authentication & Streaming ---
async function verifyApiKey(key, statusElement) {
    statusElement.textContent = "Testing connection..."; statusElement.className = "api-status";
    try {
        const res = await fetch("https://openrouter.ai/api/v1/auth/key", { method: "GET", headers: { "Authorization": `Bearer ${key}` } });
        if (res.ok) { statusElement.textContent = "Success! API Key is valid."; statusElement.className = "api-status success"; return true; } 
        else { statusElement.textContent = "Error: Invalid API Key."; statusElement.className = "api-status error"; return false; }
    } catch(err) { statusElement.textContent = "Error: Network issue."; statusElement.className = "api-status error"; return false; }
}

async function streamAiResponse(key, model, prompt, outputElement) {
    outputElement.textContent = "Connecting...\n\n"; DOM.welcome.testBtn.disabled = true; DOM.welcome.finalActions.style.display = 'none';
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }], stream: true })
        });
        if (!response.ok) { outputElement.textContent = `Connection Failed (${response.status}): ${await response.text()}`; DOM.welcome.finalActions.style.display = 'flex'; DOM.welcome.testBtn.disabled = false; return; }
        outputElement.textContent = ""; 
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let partialLine = "";
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            const chunk = decoder.decode(value, { stream: true }); const lines = (partialLine + chunk).split('\n'); partialLine = lines.pop();
            for (const line of lines) {
                if (line.trim() === "") continue;
                if (line.startsWith("data: ")) {
                    const dataStr = line.substring(6); if (dataStr === "[DONE]") break;
                    try { const data = JSON.parse(dataStr); const content = data.choices?.[0]?.delta?.content; if (content) { outputElement.textContent += content; outputElement.scrollTop = outputElement.scrollHeight; } } catch(e) { }
                }
            }
        }
        DOM.welcome.finalActions.style.display = 'flex'; DOM.welcome.testBtn.disabled = false;
    } catch (err) { outputElement.textContent = `Error: ${err.message}`; DOM.welcome.finalActions.style.display = 'flex'; DOM.welcome.testBtn.disabled = false; }
}

// --- Modal Listeners ---
DOM.welcome.verifyBtn.addEventListener('click', async () => { const key = DOM.welcome.input.value.trim(); if(!key) return; if (await verifyApiKey(key, DOM.welcome.status)) setTimeout(() => { DOM.welcome.step1.style.display = 'none'; DOM.welcome.step2.style.display = 'block'; }, 800); });
DOM.welcome.testBtn.addEventListener('click', () => { streamAiResponse(DOM.welcome.input.value.trim(), DOM.welcome.modelSelect.value, DOM.welcome.testInput.value.trim() || "Say hello!", DOM.welcome.testOutput); });
DOM.welcome.worksBtn.addEventListener('click', () => { appSettings.apiKey = DOM.welcome.input.value.trim(); appSettings.model = DOM.welcome.modelSelect.value; saveData(); DOM.welcome.modal.classList.remove('show'); });
DOM.welcome.doesntWorkBtn.addEventListener('click', () => { DOM.welcome.step2.style.display = 'none'; DOM.welcome.step1.style.display = 'block'; DOM.welcome.testOutput.textContent = "Awaiting prompt..."; DOM.welcome.finalActions.style.display = 'none'; DOM.welcome.status.textContent = ""; });

DOM.newLifeBtn.addEventListener('click', createNewLife);
DOM.tabButtons.forEach(btn => { btn.addEventListener('click', (e) => { DOM.tabButtons.forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active'); currentTab = e.currentTarget.getAttribute('data-tab'); renderGrid(); }); });

DOM.settings.btn.addEventListener('click', () => {
    DOM.settings.yearsSlider.value = appSettings.yearsPerTurn; DOM.settings.yearsValText.textContent = `${appSettings.yearsPerTurn} Year${appSettings.yearsPerTurn > 1 ? 's' : ''}`;
    DOM.settings.volatilitySlider.value = appSettings.volatility; DOM.settings.volatilityValText.textContent = volatilityLabels[appSettings.volatility - 1];
    DOM.settings.apiKeyInput.value = appSettings.apiKey; 
    DOM.settings.modelSelect.value = appSettings.model || "openai/gpt-oss-120b"; 
    DOM.settings.apiStatus.textContent = ""; 
    updateNarrativeOptions(); DOM.settings.narrativeSelect.value = appSettings.narrativeLength; DOM.settings.modal.classList.add('show');
});

const closeModal = () => DOM.settings.modal.classList.remove('show');
DOM.settings.closeBtn.addEventListener('click', closeModal); DOM.settings.cancelBtn.addEventListener('click', closeModal);
DOM.settings.testApiBtn.addEventListener('click', () => { const key = DOM.settings.apiKeyInput.value.trim(); if(key) verifyApiKey(key, DOM.settings.apiStatus); });

DOM.settings.saveBtn.addEventListener('click', () => {
    appSettings.yearsPerTurn = parseInt(DOM.settings.yearsSlider.value); appSettings.volatility = parseInt(DOM.settings.volatilitySlider.value);
    appSettings.narrativeLength = DOM.settings.narrativeSelect.value; appSettings.apiKey = DOM.settings.apiKeyInput.value.trim(); appSettings.model = DOM.settings.modelSelect.value;
    saveData(); closeModal();
});

DOM.settings.yearsSlider.addEventListener('input', (e) => { DOM.settings.yearsValText.textContent = `${e.target.value} Year${e.target.value > 1 ? 's' : ''}`; updateNarrativeOptions(); });
DOM.settings.volatilitySlider.addEventListener('input', (e) => DOM.settings.volatilityValText.textContent = volatilityLabels[e.target.value - 1]);

// Data Actions
DOM.settings.exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ lives: lives, settings: appSettings }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ailife_backup.json'; a.click(); URL.revokeObjectURL(url);
});
DOM.settings.importBtn.addEventListener('click', () => DOM.settings.importFile.click());
DOM.settings.importFile.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = (event) => {
        try { const data = JSON.parse(event.target.result); if (data.lives && data.settings) { lives = data.lives; appSettings = data.settings; saveData(); alert("Data imported!"); location.reload(); } else alert("Invalid format."); } catch(err) { alert("Error reading JSON file."); }
    }; reader.readAsText(file);
});
DOM.settings.wipeBtn.addEventListener('click', () => { if(confirm("Are you SURE you want to wipe all simulations, settings, and API keys? This cannot be undone.")) { localStorage.clear(); location.reload(); } });

function updateNarrativeOptions() {
    const years = parseInt(DOM.settings.yearsSlider.value); const select = DOM.settings.narrativeSelect;
    const previousSelection = select.value || appSettings.narrativeLength; select.innerHTML = '';
    let options = [], helpText = ""; const baseOptions = [{ text: "1 Sentence", value: "1s" }, { text: "2 Sentences", value: "2s" }];
    if (years <= 2) { options = [...baseOptions, { text: "1 Paragraph", value: "1p" }, { text: "2 Paragraphs", value: "2p" }, { text: "3 Paragraphs", value: "3p" }]; helpText = "Maximum detail allowed for short jumps."; } 
    else if (years <= 5) { options = [...baseOptions, { text: "1 Paragraph", value: "1p" }, { text: "2 Paragraphs", value: "2p" }]; helpText = "Capped at 2 paragraphs to maintain pacing."; } 
    else if (years <= 9) { options = [...baseOptions, { text: "1 Paragraph", value: "1p" }]; helpText = "Large jumps summarize events into a single paragraph."; } 
    else { options = [...baseOptions]; helpText = "Massive jumps are highly condensed."; }
    options.forEach(opt => { const optionEl = document.createElement('option'); optionEl.value = opt.value; optionEl.textContent = opt.text; select.appendChild(optionEl); });
    DOM.settings.narrativeHelpText.textContent = helpText;
    if (options.some(opt => opt.value === previousSelection)) select.value = previousSelection; else select.value = options[options.length - 1].value;
}

// --- Core Life Functions ---
function createNewLife() {
    const newLife = {
        id: Date.now().toString(), name: "Unknown Spirit", age: 0, stage: "Unborn", status: "alive", avatar: "☁️",
        traits: [], latestEvent: "Waiting to be rolled...", history: [], identity: null, stats: [], eventsLog: [], miscLog: [],
        isFreeForm: false, turnCount: 0 
    };
    lives.unshift(newLife); saveData();
    if (currentTab === 'deceased') document.querySelector('[data-tab="all"]').click(); else { renderGrid(); updateStats(); }
}

function depreciateLife(id) {
    const life = lives.find(l => l.id === id);
    if (life && life.status === 'alive') { life.status = 'deceased'; life.latestEvent = "Life was depreciated manually."; saveData(); renderGrid(); updateStats(); }
}
function deleteLife(id) { lives = lives.filter(l => l.id !== id); saveData(); renderGrid(); updateStats(); }
function resumeLife(id) { window.location.href = `game.html?id=${id}`; }

window.toggleFreeForm = function(id) {
    const life = lives.find(l => l.id === id);
    if (life) { life.isFreeForm = !life.isFreeForm; saveData(); renderGrid(); }
}

function updateStats() { DOM.statsSubtitle.textContent = `${lives.length} simulations • ${lives.filter(l => l.status === 'alive').length} alive`; }

function toggleDropdown(id, event) {
    event.stopPropagation(); document.querySelectorAll('.dropdown-menu').forEach(menu => { if (menu.id !== `dropdown-${id}`) menu.classList.remove('show'); });
    const dropdown = document.getElementById(`dropdown-${id}`); if (dropdown) dropdown.classList.toggle('show');
}

function renderGrid() {
    DOM.livesGrid.innerHTML = ''; const filteredLives = lives.filter(l => currentTab === 'all' || l.status === currentTab);
    if (filteredLives.length === 0) DOM.emptyState.style.display = 'block';
    else {
        DOM.emptyState.style.display = 'none';
        filteredLives.forEach((life, index) => {
            const isAlive = life.status === 'alive'; const statusClass = isAlive ? 'alive' : 'ended'; const statusText = isAlive ? 'Alive' : 'Ended';
            const traitsHtml = life.traits.length > 0 ? life.traits.map(t => `<span class="trait-tag">${t}</span>`).join('') : '';
            const cardHtml = `
                <div class="life-card" id="card-${life.id}" style="animation-delay: ${index * 0.05}s">
                    <div class="card-header"><div class="avatar">${life.avatar}</div>
                        <div style="display: flex; gap: 4px;">
                            ${life.isFreeForm ? '<span class="pill" style="background: rgba(76, 130, 251, 0.2); color: #8ab4f8; border: 1px solid rgba(76, 130, 251, 0.3);">Free Form</span>' : ''}
                            <span class="pill ${statusClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="card-body"><h3>${life.name}</h3><p>Age ${life.age} • ${life.stage}</p><div class="traits-preview">${traitsHtml}</div><div class="event-preview">${life.latestEvent}</div></div>
                    <div class="card-actions">
                        <button class="btn-resume" onclick="resumeLife('${life.id}')">${isAlive ? 'Resume Simulation' : 'View Legacy'}</button>
                        <button class="btn-resume dots-btn" style="width: 44px; flex: none;" onclick="toggleDropdown('${life.id}', event)"><i class="ph ph-dots-three-vertical"></i></button>
                        <div class="dropdown-menu" id="dropdown-${life.id}">
                            ${isAlive && life.history.length === 0 ? `<div class="dropdown-item" onclick="toggleFreeForm('${life.id}')"><i class="ph ph-magic-wand"></i> ${life.isFreeForm ? 'Disable' : 'Enable'} Free Form</div>` : ''}
                            ${isAlive ? `<div class="dropdown-item" onclick="depreciateLife('${life.id}')"><i class="ph ph-warning-circle"></i> Depreciate</div>` : ''}
                            <div class="dropdown-item danger" onclick="deleteLife('${life.id}')"><i class="ph ph-trash"></i> Delete Life</div>
                        </div>
                    </div>
                </div>`;
            DOM.livesGrid.insertAdjacentHTML('beforeend', cardHtml);
        });
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.dots-btn')) document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    if (e.target === DOM.settings.modal) closeModal();
});

init();