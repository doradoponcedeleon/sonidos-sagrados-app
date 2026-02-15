let mantras = [];
let selected = null;

let ctx = null;
let master = null;

let dronOsc = null;
let harmOsc = null;
let dronGain = null;

let binOscL = null, binOscR = null;
let binGainL = null, binGainR = null;

let pulseGain = null;

let timer = null;
let syllIndex = 0;
let running = false;

const $ = (id) => document.getElementById(id);

async function loadMantras() {
  const res = await fetch('mantras.json', { cache: 'no-store' });
  mantras = await res.json();
  renderList();
}

function normalize(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function renderList() {
  const q = normalize($("q").value);
  const modo = $("modo").value;
  const cat = $("cat").value;

  const list = $("list");
  list.innerHTML = "";

  const filtered = mantras.filter(m => {
    const text = normalize([m.nombre, m.tradicion, (m.intencion||[]).join(" "), (m.silabas||[]).join(" ")].join(" "));
    const okQ = !q || text.includes(q);
    const okM = !modo || m.modo === modo;
    const okC = !cat || m.categoria_frecuencia === cat;
    return okQ && okM && okC;
  });

  for (const m of filtered) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="top">
        <div class="name">${m.nombre}</div>
        <div class="badge">${m.modo || "—"}</div>
      </div>
      <div class="meta">
        dron: <b>${Number(m.dron_hz).toFixed(2)} Hz</b> · bpm: <b>${m.bpm}</b> · sílabas: <b>${(m.silabas||[]).length}</b>
      </div>
    `;
    div.addEventListener("click", () => selectMantra(m));
    list.appendChild(div);
  }

  if (!filtered.length) {
    list.innerHTML = `<div class="meta">No hay resultados.</div>`;
  }
}

function selectMantra(m) {
  selected = m;
  $("now").textContent = `${m.nombre} — dron ${Number(m.dron_hz).toFixed(2)} Hz · bpm ${m.bpm}`;
  $("dronHz").value = Number(m.dron_hz).toFixed(2);
  $("bpm").value = m.bpm;

  const b = m.binaural || {};
  $("binauralOn").checked = !!b.activo;
  $("delta").value = (b.delta_hz ?? 6.0);

  renderSyllables(m.silabas || []);
}

function renderSyllables(sylls) {
  const container = $("syll");
  container.innerHTML = "";
  for (let i = 0; i < sylls.length; i++) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = sylls[i];
    chip.dataset.i = String(i);
    container.appendChild(chip);
  }
}

function setActiveSyllable(i) {
  const chips = $("syll").querySelectorAll(".chip");
  chips.forEach(c => c.classList.remove("active"));
  const hit = $("syll").querySelector(`.chip[data-i="${i}"]`);
  if (hit) hit.classList.add("active");
}

function ensureAudio() {
  if (ctx) return;

  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 1.4;
  master.connect(ctx.destination);

  dronGain = ctx.createGain();
  dronGain.gain.value = Number($("dronVol").value);
  dronGain.connect(master);

  pulseGain = ctx.createGain();
  pulseGain.gain.value = Number($("pulseVol").value);
  pulseGain.connect(master);
}

async function startEngine() {
  if (!selected) {
    $("now").textContent = "Selecciona un mantra primero…";
    return;
  }

  ensureAudio();
  if (ctx.state === "suspended") await ctx.resume();
  stopEngine(true);
  if (master) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(1.4, ctx.currentTime);
  }

  const dronHz = Number($("dronHz").value);
  const bpm = Number($("bpm").value);
  const binauralOn = $("binauralOn").checked;
  const delta = Number($("delta").value);

  dronOsc = ctx.createOscillator();
  dronOsc.type = "sine";
  dronOsc.frequency.value = dronHz;

  harmOsc = ctx.createOscillator();
  harmOsc.type = "sine";
  harmOsc.frequency.value = dronHz * 2;

  const harmGain = ctx.createGain();
  harmGain.gain.value = 0.2;

  dronOsc.connect(dronGain);
  harmOsc.connect(harmGain);
  harmGain.connect(dronGain);

  if (binauralOn && delta > 0) {
    const fc = (selected.binaural?.portadora_hz ?? 200);
    const mix = (selected.binaural?.mix ?? 0.06);

    binOscL = ctx.createOscillator();
    binOscR = ctx.createOscillator();
    binOscL.type = "sine";
    binOscR.type = "sine";
    binOscL.frequency.value = fc + (delta / 2);
    binOscR.frequency.value = fc - (delta / 2);

    binGainL = ctx.createGain();
    binGainR = ctx.createGain();
    binGainL.gain.value = mix;
    binGainR.gain.value = mix;

    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -1;
    panR.pan.value =  1;

    binOscL.connect(binGainL); binGainL.connect(panL); panL.connect(master);
    binOscR.connect(binGainR); binGainR.connect(panR); panR.connect(master);
  }

  dronOsc.start();
  harmOsc.start();
  if (binOscL) binOscL.start();
  if (binOscR) binOscR.start();

  const sylls = selected.silabas || [];
  syllIndex = 0;
  const intervalMs = Math.max(250, Math.round(selected.duracion_silaba_ms || (60_000 / Math.max(10, bpm))));
  running = true;

  const tick = () => {
    if (!running) return;

    if (sylls.length) {
      setActiveSyllable(syllIndex);
      syllIndex = (syllIndex + 1) % sylls.length;
    }

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    const range = selected.rango_voz_hz || [dronHz * 1.2, dronHz * 1.8];
    const minF = Math.max(40, Number(range[0]) || dronHz * 1.2);
    const maxF = Math.max(minF + 10, Number(range[1]) || dronHz * 1.8);
    const step = sylls.length > 1 ? (syllIndex / (sylls.length - 1)) : 0;
    const syllFreq = minF + (maxF - minF) * step;
    osc.frequency.value = syllFreq;

    const g = ctx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g);
    g.connect(pulseGain);

    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, Number($("pulseVol").value)), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

    osc.start(t0);
    osc.stop(t0 + 0.14);
  };

  tick();
  if (timer) clearInterval(timer);
  timer = setInterval(tick, intervalMs);

  $("play").disabled = true;
  $("stop").disabled = false;
}

function stopEngine(silent = false) {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
  setActiveSyllable(-1);

  const stopNode = (node) => { try { node && node.stop && node.stop(); } catch {} };
  const disconnect = (node) => { try { node && node.disconnect && node.disconnect(); } catch {} };

  stopNode(dronOsc); disconnect(dronOsc); dronOsc = null;
  stopNode(harmOsc); disconnect(harmOsc); harmOsc = null;
  stopNode(binOscL); disconnect(binOscL); binOscL = null;
  stopNode(binOscR); disconnect(binOscR); binOscR = null;

  if (master && ctx) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
  }

  if (ctx) {
    try { ctx.close(); } catch {}
    ctx = null;
    master = null;
    dronGain = null;
    pulseGain = null;
  }

  if (!silent) {
    $("play").disabled = false;
    $("stop").disabled = true;
  }
}

function bindUI() {
  $("q").addEventListener("input", renderList);
  $("modo").addEventListener("change", renderList);
  $("cat").addEventListener("change", renderList);

  $("dronVol").addEventListener("input", () => {
    if (dronGain) dronGain.gain.value = Number($("dronVol").value);
  });
  $("pulseVol").addEventListener("input", () => {
    if (pulseGain) pulseGain.gain.value = Number($("pulseVol").value);
  });

  $("play").addEventListener("click", startEngine);
  $("stop").addEventListener("click", () => { stopEngine(); });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
}

bindUI();
loadMantras();
