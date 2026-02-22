// --- DOM Elements ---
const DOM = {
    rollBtn: document.getElementById('rollBtn'), nextAgeBtn: document.getElementById('nextAgeBtn'), actionInput: document.getElementById('actionInput'),
    diceIcon: document.getElementById('diceIcon'), genesisState: document.getElementById('genesisState'), storyContainer: document.getElementById('storyContainer'),
    topBarTitle: document.getElementById('topBarTitle'), loader: document.getElementById('aiLoader'), loaderText: document.getElementById('loaderText'),
    
    charAvatar: document.getElementById('charAvatar'), charName: document.getElementById('charName'), gender: document.getElementById('ui-gender'),
    age: document.getElementById('ui-age'), skin: document.getElementById('ui-skin'), eyes: document.getElementById('ui-eyes'),
    height: document.getElementById('ui-height'), weight: document.getElementById('ui-weight'), location: document.getElementById('ui-location'),
    race: document.getElementById('ui-race'), disabilities: document.getElementById('ui-disabilities'), stats: document.getElementById('dynamic-stats'),
    events: document.getElementById('events'), traits: document.getElementById('traits'), misc: document.getElementById('misc')
};

// --- Global Data Context ---
let currentLife = null;
let allLives = [];
let appSettings = {};

const volatilityMap = { 1: "Peaceful & Mundane", 2: "Calm", 3: "Realistic Life", 4: "Dramatic & Unpredictable", 5: "Extremely Chaotic & Dangerous" };

function initGame() {
    const urlParams = new URLSearchParams(window.location.search);
    const lifeId = urlParams.get('id');

    if (!lifeId) { window.location.href = 'index.html'; return; }

    const savedLives = localStorage.getItem('ailife_lives');
    const savedSettings = localStorage.getItem('ailife_settings');
    
    if (savedSettings) appSettings = JSON.parse(savedSettings);
    if (!appSettings.apiKey) { alert("API Key required."); window.location.href = 'index.html'; return; }

    if (savedLives) {
        allLives = JSON.parse(savedLives);
        currentLife = allLives.find(l => l.id === lifeId);
    }

    if (!currentLife) { window.location.href = 'index.html'; return; }
    currentLife.turnCount = currentLife.turnCount || 0; 

    if (currentLife.history && currentLife.history.length > 0) {
        restoreUI();
    } else {
        DOM.charName.textContent = currentLife.name;
    }
}

function saveCurrentLife() {
    const index = allLives.findIndex(l => l.id === currentLife.id);
    if (index !== -1) {
        allLives[index] = currentLife;
        localStorage.setItem('ailife_lives', JSON.stringify(allLives));
    }
}

// --- OPTIMIZATION HELPERS ---
function getSyncInterval() {
    const m = appSettings.model || "";
    // Massive Context Models: Sync rarely (saves tons of tokens)
    if (m.includes("grok") || m.includes("kimi") || m.includes("claude") || m.includes("scout") || m.includes("70b") || m.includes("405b") || m.includes("4o")) return 15;
    // Standard Context: Sync often
    return 5; 
}

function generateRNGSeed() {
    const genders = ["Male", "Female"];
    const wealthTiers = ["in poverty", "to a working-class family", "to a middle-class family", "to a wealthy family"];
    const continents = ["North America", "South America", "Europe", "Asia", "Africa", "Oceania"];
    
    const baseHealth = Math.floor(Math.random() * 11) + 75; // 75-85
    const baseHappiness = Math.floor(Math.random() * 11) + 75; // 75-85
    const baseIQ = Math.floor(Math.random() * 11) + 90; // 90-100

    return { 
        gender: genders[Math.floor(Math.random() * genders.length)], 
        wealth: wealthTiers[Math.floor(Math.random() * wealthTiers.length)], 
        region: continents[Math.floor(Math.random() * continents.length)],
        baseHealth, baseHappiness, baseIQ
    };
}

// --- OPENROUTER API LOGIC ---
async function fetchAI(systemPrompt, userMsg) {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${appSettings.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: appSettings.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMsg }
                ],
                temperature: currentLife.isFreeForm ? 0.9 : 0.7 
            })
        });

        if (!response.ok) throw new Error(`API Error: ${response.status} ${await response.text()}`);
        
        const data = await response.json();
        const content = data.choices[0].message.content;
        console.log("Raw AI Output:", content);
        return extractJSON(content);
        
    } catch (err) {
        console.error("Fetch Error:", err);
        return { error: err.message };
    }
}

// BULLETPROOF JSON EXTRACTOR (Fixes Grok / Conversational AI issues)
function extractJSON(text) {
    if (!text) return null;
    
    // 1. Try pure JSON parse
    try { return JSON.parse(text); } catch (e) {}
    
    // 2. Try extracting from markdown code blocks ```json { ... } ```
    const codeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeMatch) {
        try { return JSON.parse(codeMatch[1]); } catch (e) {}
    }
    
    // 3. Try grabbing everything between the first { and the last }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const sliced = text.substring(firstBrace, lastBrace + 1);
        try { return JSON.parse(sliced); } catch (e) {}
    }
    
    return null; // Absolute failure
}

function formatMarkdown(text) {
    if(!text) return "";
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
}

// --- THE MASTER PROMPT BUILDER ---
function getSystemPrompt(isGenesis, targetAge) {
    const baseRules = `You are AILife, a life simulator engine.
OUTPUT STRICTLY AS VALID JSON. No conversational text outside the JSON.

JSON SCHEMA:
{
  "yearly_logs": [ { "age": integer, "text": "...", "event": "major event or null" } ],
  "stat_changes": {"Health": integer, "Happiness": integer, "Intelligence": integer},
  "physical": {"Height": "...", "Weight": "...", "Gender": "Male|Female|Non-binary", "Skin": "...", "Eyes": "...", "Location": "...", "Race": "...", "Disabilities": "..." },
  "traits": {"add": ["..."], "remove": ["..."]},
  "memories": {"add": ["..."], "remove": ["..."]},
  "misc": {"add": ["..."], "remove": ["..."]},
  "alerts": ["+5 IQ", "-10% Health"],
  "dead": boolean,
  "name": "Full Name",
  "avatar": "1 Emoji"
}

CRITICAL RULES:
1. STAT CHANGES: 'stat_changes' is for RELATIVE DELTAS ONLY (e.g., -15, +5). NEVER output the total current value! If a stat did not change, DO NOT include it. Negative events (injuries, depression) MUST use NEGATIVE numbers (e.g. "Health": -20). Positive events use positive numbers.
2. ABSOLUTE PHYSICALS: 'physical' object MUST contain absolute current values (e.g., "5'2\""). If unchanged, return the current value.
3. PERSONALITY: Use your native AI personality! If you tend to be witty, edgy, analytical, or poetic, embrace it in the story text.
4. FORMATTING: You may use markdown (**bold**, *italics*) in the text, but ABSOLUTELY NO headings (#).
5. ALERTS: The "alerts" array is ONLY for visual text. You must still put the actual math in "stat_changes".`;

    let modeRules = "";
    if (currentLife.isFreeForm && !isGenesis) {
        modeRules = `\nFREEFORM MODE: UNRESTRICTED.
- The user is in total control. Magic, surrealism, violence, and rule-breaking are allowed. Ignore settings limits.
- Answer their questions directly in the 'text' field.
- Do NOT advance the character's age UNLESS the user explicitly asks to "jump X years".
- If they ask to jump multiple years, DO NOT generate intermediate years. Generate exactly ONE log in 'yearly_logs' for the final destination age.`;
    } else {
        modeRules = `\nNARRATIVE & GAME RULES:
- Generate EXACTLY ${appSettings.yearsPerTurn} objects in 'yearly_logs'. 'text' length MUST be exactly: ${appSettings.narrativeLength.replace('p', ' paragraphs').replace('s', ' sentences')}. 
- Volatility is [${volatilityMap[appSettings.volatility]}].
- AGE-APPROPRIATE BEHAVIOR: Characters act their physical/mental age.
- LOGICAL CAUSALITY: You CANNOT magically change physical traits unless realistically contextualized (e.g., surgery) or make the attempt fail.`;
    }

    const syncRate = getSyncInterval();
    const isFullSync = isGenesis || currentLife.isFreeForm || (currentLife.turnCount % syncRate === 0);

    const i = currentLife.identity || {};
    const statStr = (currentLife.stats||[]).map(s => `${s.name}: ${s.value}`).join(', ');
    const memStr = (currentLife.eventsLog||[]).slice(0, 5).join(', ') || "None";
    const traitStr = (currentLife.traits||[]).slice(0, 5).join(', ') || "None";

    let stateContext = ``;
    if (isGenesis) {
        stateContext = `\nGENESIS MODE: The user is being born at Age 0. Generate ONE entry in 'yearly_logs' for Age 0.`;
    } else {
        stateContext = `\nCURRENT STATE:\nName: ${currentLife.name}, Current Age: ${currentLife.age}\nStats: ${statStr}\nRecent Memories: ${memStr}`;
        if (isFullSync) {
            const idStr = `Gender: ${i.gender||'--'}, Skin: ${i.skin||'--'}, Eyes: ${i.eyes||'--'}, Height: ${i.height||'--'}, Weight: ${i.weight||'--'}, Location: ${i.location||'--'}, Race: ${i.race||'--'}, Disabilities: ${i.disabilities||'None'}`;
            stateContext += `\nIdentity: ${idStr}\nTraits: ${traitStr}`;
        } else {
            stateContext += `\n(Identity & Traits omitted this turn. Assume they remain consistent.)`;
        }
        stateContext += `\n\nINSTRUCTIONS: Respond to the User Action. ${!currentLife.isFreeForm ? `Simulate up to Age ${targetAge}.` : ''}`;
    }

    return baseRules + "\n" + modeRules + "\n" + stateContext;
}

// --- INTERACTIONS ---
DOM.rollBtn.addEventListener('click', async () => {
    const customPrompt = DOM.actionInput.value.trim();
    DOM.loaderText.textContent = "Simulating Genesis...";
    DOM.loader.classList.add('active');
    
    const seed = generateRNGSeed();
    const systemPrompt = getSystemPrompt(true, 0);
    let userMsg = `RNG Seed: Born ${seed.gender}, ${seed.wealth}, in ${seed.region}.`;
    if (customPrompt) userMsg += `\nUSER PROMPT (OVERRIDES SEED): "${customPrompt}"`;

    currentLife.identity = {}; 
    currentLife.stats = [
        { name: "Health", value: seed.baseHealth, color: "var(--success)" },
        { name: "Happiness", value: seed.baseHappiness, color: "var(--accent)" },
        { name: "Intelligence", value: seed.baseIQ, color: "var(--warning)" }
    ];
    currentLife.traits = []; currentLife.eventsLog = []; currentLife.miscLog = []; currentLife.history = [];
    currentLife.turnCount = 1;

    const aiData = await fetchAI(systemPrompt, userMsg);
    DOM.loader.classList.remove('active');

    if (aiData && !aiData.error) {
        applyAIDataToState(aiData, customPrompt, true);
        DOM.rollBtn.style.display = 'none';
        DOM.genesisState.style.display = 'none';
        restoreUI();
    } else {
        handleAIError(aiData ? aiData.error : "Failed to parse JSON response.");
    }
});

DOM.nextAgeBtn.addEventListener('click', async () => {
    const customPrompt = DOM.actionInput.value.trim();
    DOM.loaderText.textContent = currentLife.isFreeForm ? "Generating response..." : `Simulating next ${appSettings.yearsPerTurn} years...`;
    DOM.loader.classList.add('active');
    
    const targetAge = currentLife.age + appSettings.yearsPerTurn;
    const systemPrompt = getSystemPrompt(false, targetAge);
    const userMsg = customPrompt ? `User Action: "${customPrompt}"` : "Continue living naturally.";

    const aiData = await fetchAI(systemPrompt, userMsg);
    DOM.loader.classList.remove('active');

    if (aiData && !aiData.error) {
        currentLife.turnCount += 1;
        DOM.actionInput.value = ''; 
        applyAIDataToState(aiData, customPrompt, false);
        restoreUI();
    } else {
        handleAIError(aiData ? aiData.error : "Failed to parse JSON response.");
    }
});

function handleAIError(errorMsg) {
    const html = `
        <div class="fade-in" style="margin-top: 20px; background: rgba(234, 67, 53, 0.1); border-left: 4px solid var(--danger); padding: 16px; border-radius: 6px; color: #e8eaed; font-size: 0.9rem;">
            <strong style="color: var(--danger);">Engine Error:</strong> The AI model lost its train of thought or formatted the data incorrectly.<br><br>
            <span style="color: var(--text-dim); font-size: 0.8rem;">Details: ${errorMsg}</span><br>
            <em>Please click the button to try again or rephrase your prompt.</em>
        </div>
    `;
    DOM.storyContainer.insertAdjacentHTML('beforeend', html);
    const historyPane = document.getElementById('historyPane');
    historyPane.scrollTop = historyPane.scrollHeight;
}


// --- STATE MANAGEMENT ---
function applyAIDataToState(data, promptUsed, isGenesis) {
    if (data.name) currentLife.name = data.name;
    if (data.avatar) currentLife.avatar = data.avatar;
    if (data.dead) currentLife.status = 'deceased';

    // Apply Physicals
    if (data.physical) {
        const p = data.physical;
        const getVal = (keys) => { for(let k of keys) if(p[k]) return p[k]; return null; };
        
        currentLife.identity.gender = getVal(['Gender', 'gender']) || currentLife.identity.gender;
        currentLife.identity.skin = getVal(['Skin', 'skin']) || currentLife.identity.skin;
        currentLife.identity.eyes = getVal(['Eyes', 'eyes']) || currentLife.identity.eyes;
        currentLife.identity.height = getVal(['Height', 'height']) || currentLife.identity.height;
        currentLife.identity.weight = getVal(['Weight', 'weight']) || currentLife.identity.weight;
        currentLife.identity.location = getVal(['Location', 'location']) || currentLife.identity.location;
        currentLife.identity.race = getVal(['Race', 'race']) || currentLife.identity.race;
        currentLife.identity.disabilities = getVal(['Disabilities', 'disabilities']) || currentLife.identity.disabilities;
    }

    // Apply Stat Math (BULLETPROOF STRING/NUMBER FIX)
    const statChanges = data.stat_changes || data.stats; // Look for new schema key, fallback to old just in case
    if (statChanges) {
        for (const [key, changeRaw] of Object.entries(statChanges)) {
            const cleanStr = String(changeRaw).replace(/[^0-9-]/g, ''); // Extract just numbers and minus signs
            let change = parseInt(cleanStr, 10);
            if (isNaN(change)) continue; 

            let statName = key;
            if (key.toLowerCase().includes('iq') || key.toLowerCase().includes('intelligence')) statName = 'Intelligence';
            if (key.toLowerCase().includes('health')) statName = 'Health';
            if (key.toLowerCase().includes('happ')) statName = 'Happiness';

            let stat = currentLife.stats.find(s => s.name === statName);
            
            if (stat) {
                // Ensure stat.value is an integer before adding to prevent string concatenation (e.g. "95"+3="953")
                stat.value = parseInt(stat.value, 10) + change; 
            } else {
                let color = "var(--accent)";
                let startVal = isGenesis ? change : (statName === 'Intelligence' ? 100 + change : 50 + change);
                if (statName === 'Health') color = "var(--success)";
                if (statName === 'Intelligence') color = "var(--warning)";
                currentLife.stats.push({ name: statName, value: startVal, color: color });
            }
        }
        currentLife.stats.forEach(s => {
            if (s.name === 'Intelligence') { if (s.value < 0) s.value = 0; } 
            else { if (s.value > 100) s.value = 100; if (s.value < 0) s.value = 0; }
        });
    }

    // Apply Arrays
    if (data.traits) {
        if (data.traits.add) currentLife.traits = [...new Set([...currentLife.traits, ...data.traits.add])];
        if (data.traits.remove) currentLife.traits = currentLife.traits.filter(t => !data.traits.remove.includes(t));
    }
    if (data.memories) {
        if (data.memories.add) currentLife.eventsLog = [...data.memories.add, ...currentLife.eventsLog];
        if (data.memories.remove) currentLife.eventsLog = currentLife.eventsLog.filter(m => !data.memories.remove.includes(m));
    }
    if (data.misc) {
        if (data.misc.add) currentLife.miscLog = [...new Set([...currentLife.miscLog, ...data.misc.add])];
        if (data.misc.remove) currentLife.miscLog = currentLife.miscLog.filter(m => !data.misc.remove.includes(m));
    }
    if (currentLife.eventsLog.length > 15) currentLife.eventsLog.length = 15;

    // Process Yearly Logs
    if (data.yearly_logs && Array.isArray(data.yearly_logs)) {
        data.yearly_logs.forEach((log, index) => {
            currentLife.age = parseInt(log.age, 10) || currentLife.age;
            
            if (currentLife.age === 0) currentLife.stage = "Childhood";
            else if (currentLife.age > 12 && currentLife.age < 18) currentLife.stage = "Teenager";
            else if (currentLife.age >= 18 && currentLife.age < 60) currentLife.stage = "Adulthood";
            else if (currentLife.age >= 60) currentLife.stage = "Elderly";

            if (log.event) currentLife.latestEvent = log.event;

            currentLife.history.push({
                age: currentLife.age,
                prompt: index === 0 ? promptUsed : null,
                text: log.text || "...",
                ui_alerts: (index === data.yearly_logs.length - 1) ? data.alerts : []
            });
        });
    }

    saveCurrentLife();
}

// --- UI RESTORATION ---
function restoreUI() {
    DOM.genesisState.style.display = 'none';
    DOM.rollBtn.style.display = 'none';
    
    if (currentLife.status === 'alive') {
        DOM.nextAgeBtn.style.display = 'flex';
        DOM.actionInput.disabled = false;
        
        if (currentLife.isFreeForm) {
            DOM.nextAgeBtn.innerHTML = `Send <i class="ph ph-paper-plane-right"></i>`;
            DOM.actionInput.placeholder = "Talk to the AI... (e.g. 'Jump 5 years' or 'Buy a dog')";
        } else {
            DOM.nextAgeBtn.innerHTML = `Next Age <i class="ph ph-arrow-right"></i>`;
            DOM.actionInput.placeholder = "Intervene... e.g. 'Start a journal'";
        }
    } else {
        DOM.nextAgeBtn.style.display = 'none';
        DOM.actionInput.disabled = true;
        DOM.actionInput.placeholder = "Simulation Ended.";
    }
    
    DOM.topBarTitle.innerHTML = `${currentLife.name} / <span style="color: white;">Age ${currentLife.age}</span>`;
    
    renderSidebar();
    renderHistory();
}

function renderSidebar() {
    DOM.charAvatar.textContent = currentLife.avatar;
    DOM.charName.textContent = currentLife.name;
    
    if (currentLife.identity) {
        DOM.gender.textContent = currentLife.identity.gender || "--";
        DOM.age.textContent = currentLife.age + "y";
        DOM.skin.textContent = currentLife.identity.skin || "--";
        DOM.eyes.textContent = currentLife.identity.eyes || "--";
        DOM.height.textContent = currentLife.identity.height || "--";
        DOM.weight.textContent = currentLife.identity.weight || "--";
        DOM.location.textContent = currentLife.identity.location || "--";
        DOM.race.textContent = currentLife.identity.race || "--";
        DOM.disabilities.textContent = currentLife.identity.disabilities || "None";
    }

    if (currentLife.stats && currentLife.stats.length > 0) {
        DOM.stats.innerHTML = currentLife.stats.map(s => {
            let displayVal = `${s.value}%`;
            let barWidth = s.value;
            if (s.name === 'Intelligence') { displayVal = `${s.value} IQ`; barWidth = Math.min(100, (s.value / 200) * 100); }
            return `
            <div class="stat-row">
                <div class="stat-info"><span>${s.name}</span><span>${displayVal}</span></div>
                <div class="progress-bg"><div class="progress-fill" style="width: ${barWidth}%; background: ${s.color};"></div></div>
            </div>`;
        }).join('');
    }

    if (currentLife.eventsLog && currentLife.eventsLog.length > 0) DOM.events.innerHTML = currentLife.eventsLog.map(e => `<div class="list-item"><div>${e}</div></div>`).join('');
    if (currentLife.traits && currentLife.traits.length > 0) DOM.traits.innerHTML = currentLife.traits.map(t => `<span class="trait-tag">${t}</span>`).join('');
    if (currentLife.miscLog && currentLife.miscLog.length > 0) DOM.misc.innerHTML = currentLife.miscLog.map(m => `<div class="list-item" style="border-left: 2px solid var(--accent);">${m}</div>`).join('');
}

function renderHistory() {
    DOM.storyContainer.innerHTML = '';
    let lastAgeRendered = -1;

    currentLife.history.forEach((block) => {
        const isSameAge = block.age === lastAgeRendered;
        lastAgeRendered = block.age;

        let ageHeaderHtml = '';
        if (!isSameAge || !currentLife.isFreeForm) {
            ageHeaderHtml = `<div class="age-container fade-in" style="margin-top:30px;"><h2>Age ${block.age}</h2></div>`;
        }

        let promptHtml = '';
        if (block.prompt) {
            promptHtml = `
            <div class="fade-in" style="background: rgba(76, 130, 251, 0.1); padding: 12px 16px; border-radius: 8px; margin-top: ${isSameAge ? '20px' : '10px'}; border-left: 3px solid var(--accent); color: #e8eaed; font-size: 0.9rem;">
                <strong style="color: var(--accent);"><i class="ph ph-user"></i> You:</strong> ${block.prompt}
            </div>`;
        }
            
        let alertHtml = '';
        if (block.ui_alerts && block.ui_alerts.length > 0) {
            const pills = block.ui_alerts.map(alert => {
                const isNegative = alert.includes('-') || alert.toLowerCase().includes('lost') || alert.toLowerCase().includes('decrease');
                const color = isNegative ? 'var(--danger)' : 'var(--success)';
                const icon = isNegative ? '▼' : '▲';
                return `<div class="delta-pill"><span style="color: ${color};">${icon}</span> ${alert}</div>`;
            }).join('');
            alertHtml = `<div class="fade-in" style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;">${pills}</div>`;
        }

        const formattedText = formatMarkdown(block.text);

        const html = `
            <div style="margin-bottom: ${isSameAge && currentLife.isFreeForm ? '20px' : '40px'};">
                ${ageHeaderHtml}
                ${promptHtml}
                <p class="fade-in" style="margin-top: ${promptHtml ? '12px' : '10px'}; animation-delay: 0.1s; line-height: 1.8;">${formattedText}</p>
                ${alertHtml}
            </div>
        `;
        DOM.storyContainer.insertAdjacentHTML('beforeend', html);
    });
    
    const historyPane = document.getElementById('historyPane');
    historyPane.scrollTop = historyPane.scrollHeight;
}

initGame();