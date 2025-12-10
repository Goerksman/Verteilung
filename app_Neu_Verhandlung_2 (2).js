/* ============================================================
   HILFSFUNKTIONEN
============================================================ */

// ZENTRALE RUNDEFUNKTION: ALLE BETRÄGE AUF GANZE EURO
const roundEuro = n => Math.round(Number(n));

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const eur = n =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(roundEuro(n));

const app = document.getElementById("app");



/* ============================================================
   DIMENSIONSSYSTEM
============================================================ */

const DIM_FACTORS = [1.0, 1.3, 1.5];
let DIM_QUEUE = [];

function shuffleDimensions() {
  DIM_QUEUE = [...DIM_FACTORS];
  for (let i = DIM_QUEUE.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [DIM_QUEUE[i], DIM_QUEUE[j]] = [DIM_QUEUE[j], DIM_QUEUE[i]];
  }
}

function nextDimension() {
  if (DIM_QUEUE.length === 0) shuffleDimensions();
  return DIM_QUEUE.pop();
}



/* ============================================================
   SPIELZUSTAND
============================================================ */

function newState() {
  const f = nextDimension();

  const baseStart = 5500;
  const baseMin   = 3500;

  return {
    participant_id: crypto.randomUUID?.() || "v_" + Date.now(),

    runde: 1,
    max_runden: randInt(8, 12),

    scale: f,

    initial_offer: roundEuro(baseStart * f),
    min_price:     roundEuro(baseMin   * f),
    current_offer: roundEuro(baseStart * f),

    history: [],
    accepted: false,
    finished: false,

    warningText: "",
    patternMessage: ""
  };
}

let state = newState();



/* ============================================================
   AUTO-ACCEPT LOGIK
============================================================ */

function shouldAccept(userOffer) {
  userOffer = roundEuro(userOffer);

  const s = state.current_offer;
  const f = state.scale;

  const diffPerc = Math.abs(s - userOffer) / s;

  if (userOffer >= s) return true;
  if (diffPerc <= 0.05) return true;
  if (userOffer >= roundEuro(5000 * f)) return true;

  if (state.max_runden - state.runde <= 1 && userOffer >= state.min_price)
    return true;

  return false;
}



/* ============================================================
   PREISUPDATE (VERKÄUFER)
============================================================ */

function computeNextOffer(userOffer) {

  if (shouldAccept(userOffer)) return roundEuro(userOffer);

  const f = state.scale;
  const r = state.runde;
  const min = state.min_price;
  const curr = state.current_offer;

  let next;

  if (r === 1) {
    next = curr - roundEuro(1000 * f);
  } else if (r === 2) {
    next = curr - roundEuro(500 * f);
  } else if (r === 3) {
    next = curr - roundEuro(250 * f);
  } else {
    next = curr - (curr - min) * 0.40;
  }

  if (next < min) next = min;

  return roundEuro(next);
}



/* ============================================================
   WARNUNGEN
============================================================ */

function getWarning(userOffer) {
  userOffer = roundEuro(userOffer);

  const f = state.scale;
  const LOWBALL_LIMIT = roundEuro(2250 * f);
  const SMALL_STEP_LIMIT = roundEuro(100 * f);

  const last = state.history[state.history.length - 1];

  if (userOffer < LOWBALL_LIMIT)
    return `Ihr Angebot liegt deutlich unter dem akzeptablen Bereich (${eur(LOWBALL_LIMIT)}).`;

  if (last && last.proband_counter != null) {
    const diff = userOffer - last.proband_counter;
    if (diff > 0 && diff <= SMALL_STEP_LIMIT)
      return `Ihre Erhöhung ist sehr klein (≤ ${eur(SMALL_STEP_LIMIT)}). Bitte machen Sie einen größeren Schritt.`;
  }

  return "";
}



/* ============================================================
   RISIKO-SYSTEM (NEU: 1500-SOFORT-ABBRUCH + DIFFERENZMODELL)
============================================================ */

// Risiko basierend nur auf der Differenz
function abortProbability(diff) {
  diff = roundEuro(diff);
  const f = state.scale;

  let chance = 0;

  if (diff >= roundEuro(1000 * f)) chance += 40;
  else if (diff >= roundEuro(750 * f)) chance += 30;
  else if (diff >= roundEuro(500 * f)) chance += 20;
  else if (diff >= roundEuro(250 * f)) chance += 10;
  else if (diff >= roundEuro(100 * f)) chance += 5;

  return Math.min(Math.max(chance, 0), 100);
}


// maybeAbort: berücksichtigt 1500-Regel und Risiko
function maybeAbort(userOffer) {

  const f = state.scale;
  const seller = state.current_offer;
  const buyer = roundEuro(userOffer);

  // 1) SOFORTABBRUCH
  if (buyer < roundEuro(1500 * f)) {

    logRound({
      runde: state.runde,
      algo_offer: seller,
      proband_counter: buyer,
      accepted: false,
      finished: true,
      deal_price: ""
    });

    state.finished = true;
    state.accepted = false;
    viewAbort(100);

    return true;
  }

  // 2) Risiko nach Differenz
  const diff = Math.abs(seller - buyer);
  const chance = abortProbability(diff);
  const roll = randInt(1, 100);

  if (roll <= chance) {
    logRound({
      runde: state.runde,
      algo_offer: seller,
      proband_counter: buyer,
      accepted: false,
      finished: true,
      deal_price: ""
    });

    state.finished = true;
    state.accepted = false;
    viewAbort(chance);

    return true;
  }

  return false;
}



/* ============================================================
   PATTERNERKENNUNG
============================================================ */

function updatePatternMessage() {
  const f = state.scale;
  const limit = roundEuro(2250 * f);

  const counters = state.history
    .map(h => h.proband_counter)
    .filter(v => v && v >= limit);

  if (counters.length < 3) {
    state.patternMessage = "";
    return;
  }

  let chain = 1;

  for (let i = 1; i < counters.length; i++) {
    const diff = counters[i] - counters[i - 1];
    if (diff > 0 && diff <= roundEuro(100 * f)) chain++;
    else chain = 1;
  }

  state.patternMessage =
    chain >= 3
      ? "Sie bewegen sich nur in sehr kleinen Schritten. Bitte kommen Sie etwas entgegen."
      : "";
}



/* ============================================================
   LOGGING
============================================================ */

function logRound(row) {
  if (window.sendRow) {
    window.sendRow({
      participant_id: state.participant_id,
      player_id: window.playerId,
      proband_code: window.probandCode,
      ...row
    });
  }
}



/* ============================================================
   HISTORY RENDER
============================================================ */

function renderHistory() {
  if (!state.history.length) return "";

  return `
    <h2>Verlauf</h2>
    <table>
      <thead><tr><th>R</th><th>Verkäufer</th><th>Du</th></tr></thead>
      <tbody>
        ${state.history.map(h => `
          <tr>
            <td>${h.runde}</td>
            <td>${eur(h.algo_offer)}</td>
            <td>${h.proband_counter != null ? eur(h.proband_counter) : "-"}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
}



/* ============================================================
   SCREENS
============================================================ */

function viewAbort(chance) {
  app.innerHTML = `
    <div class="card">
      <h1>Verhandlung abgebrochen</h1>
      <p>Abbruchwahrscheinlichkeit: <b>${chance}%</b></p>
      ${renderHistory()}
      <button id="restartBtn">Neu starten</button>
    </div>
  `;

  document.getElementById("restartBtn").onclick = () => {
    state = newState();
    viewVignette();
  };
}



function viewVignette() {
  app.innerHTML = `
    <div class="card">
      <h1>Designer-Verkaufsmesse</h1>
      <p>Sie verhandeln über eine hochwertige <b>Designer-Ledercouch</b>.</p>
      <p class="muted">Zu kleine Schritte oder sehr niedrige Angebote erhöhen das Abbruchrisiko.</p>

      <label class="consent">
        <input id="consent" type="checkbox">
        <span>Ich stimme der anonymen Speicherung zu.</span>
      </label>

      <button id="startBtn" disabled>Starten</button>
    </div>
  `;

  const c = document.getElementById("consent");
  const b = document.getElementById("startBtn");
  c.onchange = () => b.disabled = !c.checked;
  b.onclick = () => { state = newState(); viewNegotiate(); };
}



function viewNegotiate(errorMsg = "") {

  const last = state.history[state.history.length - 1];
  const seller = state.current_offer;
  const buyer = last ? last.proband_counter : seller;

  const diff = Math.abs(seller - buyer);

  let abortChance =
    buyer < roundEuro(1500 * state.scale)
      ? 100
      : abortProbability(diff);

  let color = "#16a34a";
  if (abortChance > 50) color = "#ea580c";
  else if (abortChance > 25) color = "#eab308";

  app.innerHTML = `
    <div class="card">
      <h1>Verkaufsverhandlung</h1>

      <div class="card">
        <strong>Aktuelles Angebot:</strong> ${eur(state.current_offer)}
      </div>

      <div style="border-left:6px solid ${color}; padding:10px; background:${color}22;">
        <b style="color:${color};">Abbruchwahrscheinlichkeit:</b>
        <span>${abortChance}%</span>
      </div>

      <label>Dein Gegenangebot:</label>
      <input id="counter" type="number">

      <button id="sendBtn">Senden</button>
      <button id="acceptBtn" class="ghost">Annehmen</button>

      ${state.warningText ? `<p style="color:#b91c1c">${state.warningText}</p>` : ""}
      ${state.patternMessage ? `<p class="muted">${state.patternMessage}</p>` : ""}
      ${errorMsg ? `<p style="color:red">${errorMsg}</p>` : ""}

      ${renderHistory()}
    </div>
  `;

  document.getElementById("sendBtn").onclick =
    () => handleSubmit(document.getElementById("counter").value);

  document.getElementById("acceptBtn").onclick =
    () => finish(true, state.current_offer);
}



/* ============================================================
   HANDLE SUBMIT
============================================================ */

function handleSubmit(raw) {

  const num = roundEuro(Number(raw));
  if (!Number.isFinite(num) || num <= 0)
    return viewNegotiate("Bitte eine gültige Zahl eingeben.");

  if (state.history.length > 0) {
    const last = state.history[state.history.length - 1].proband_counter;
    if (last && num < last)
      return viewNegotiate("Sie dürfen kein niedrigeres Angebot machen.");
  }

  state.warningText = getWarning(num);

  if (shouldAccept(num)) {
    logRound({
      runde: state.runde,
      algo_offer: state.current_offer,
      proband_counter: num,
      accepted: true,
      finished: true,
      deal_price: num
    });
    return finish(true, num);
  }

  if (maybeAbort(num)) return;

  state.history.push({
    runde: state.runde,
    algo_offer: state.current_offer,
    proband_counter: num
  });

  updatePatternMessage();

  logRound({
    runde: state.runde,
    algo_offer: state.current_offer,
    proband_counter: num,
    accepted: false,
    finished: false,
    deal_price: ""
  });

  state.current_offer = computeNextOffer(num);

  if (state.runde >= state.max_runden)
    return viewDecision();

  state.runde++;
  viewNegotiate();
}



/* ============================================================
   LETZTE RUNDE
============================================================ */

function viewDecision() {
  app.innerHTML = `
    <div class="card">
      <h1>Letzte Runde</h1>
      <p>Letztes Angebot: ${eur(state.current_offer)}</p>

      <button id="acceptBtn">Annehmen</button>
      <button id="declineBtn" class="ghost">Ablehnen</button>

      ${renderHistory()}
    </div>
  `;

  document.getElementById("acceptBtn").onclick =
    () => finish(true, state.current_offer);

  document.getElementById("declineBtn").onclick =
    () => finish(false, null);
}



/* ============================================================
   FINISH SCREEN
============================================================ */

function finish(accepted, dealPrice) {

  if (dealPrice != null)
    dealPrice = roundEuro(dealPrice);

  state.accepted = accepted;
  state.finished = true;
  state.deal_price = dealPrice;

  logRound({
    runde: state.runde,
    algo_offer: state.current_offer,
    proband_counter: dealPrice,
    accepted,
    finished: true,
    deal_price: dealPrice
  });

  app.innerHTML = `
    <div class="card">
      <h1>Verhandlung beendet</h1>
      <p>${accepted ? `Einigung bei <b>${eur(dealPrice)}</b>` : "Keine Einigung."}</p>

      ${renderHistory()}

      <button id="restartBtn">Neu starten</button>
    </div>
  `;

  document.getElementById("restartBtn").onclick = () => {
    state = newState();
    viewVignette();
  };
}



/* ============================================================
   INIT
============================================================ */

viewVignette();



