import { useState, useEffect, useRef, useCallback } from "react";

// ─── UTILS ────────────────────────────────────────────────────────────────────
let _id = Date.now();
const uid = () => String(++_id);
const stripFences = (s) => {
  // Remove markdown code fences without using backticks in source
  const fence = String.fromCharCode(96,96,96); // three backticks
  return (s||"").split(fence+"json").join("").split(fence).join("").trim();
};
// Corregge la pronuncia per la sintesi vocale italiana
const fixPronunciation = (text) => {
  let t = text || "";
  // "Michi" viene letto "mici" — forziamo la grafia fonetica "Mikki"
  t = t.replace(/\bMichi\b/g, "Mìkki");
  t = t.replace(/\bmichi\b/g, "mìkki");
  return t;
};

// Saluto contestuale vivo (giorno, mese, stagione, ora)
const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const GIORNI = ["domenica","lunedì","martedì","mercoledì","giovedì","venerdì","sabato"];
const contextualGreeting = (hasProjects) => {
  const now = new Date();
  const h = now.getHours();
  const giorno = GIORNI[now.getDay()];
  const mese = MESI[now.getMonth()];
  const numGiorno = now.getDate();
  const m = now.getMonth();
  // Fascia oraria
  let saluto;
  if (h < 6)       saluto = "Sei mattiniero stanotte";
  else if (h < 12) saluto = "Buongiorno";
  else if (h < 14) saluto = "Buon pomeriggio";
  else if (h < 18) saluto = "Buon pomeriggio";
  else if (h < 22) saluto = "Buonasera";
  else             saluto = "Si lavora fino a tardi stasera";
  // Stagione / contesto del mese
  let nota = "";
  if (m===11 || m===0) nota = "Con questo freddo, una bella commessa scalda più del camino.";
  else if (m>=2 && m<=4) nota = "È primavera, periodo buono per partire con i lavori.";
  else if (m>=5 && m<=7) nota = "In piena estate, occhio alle consegne prima delle ferie.";
  else if (m>=8 && m<=10) nota = "Si rientra a pieno ritmo, c'è da lavorare.";
  const domanda = hasProjects
    ? "Sei pronto ad analizzare il prossimo preventivo?"
    : "Sei pronto ad analizzare il tuo primo preventivo?";
  const apertura = [
    saluto + "! Oggi è " + giorno + " " + numGiorno + " " + mese + ".",
    nota,
    domanda
  ].filter(Boolean).join(" ");
  return apertura;
};
// Saluto agente (dentro un preventivo) — vario, da AI connessa
const agentGreeting = (project) => {
  const now = new Date();
  const h = now.getHours();
  const giorno = GIORNI[now.getDay()];
  let saluto = h < 12 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
  const haCliente = project && project.client;
  if (haCliente) {
    return saluto + "! Riprendiamo il preventivo per " + project.client + ". Dimmi su cosa lavoriamo.";
  }
  const aperture = [
    saluto + ", è " + giorno + ". Mettiamoci al lavoro: per chi è questo preventivo e cosa dobbiamo realizzare?",
    saluto + "! Pronto a costruire un buon preventivo. Per chi lo facciamo?",
    saluto + ". Bene, foglio bianco e tanta voglia di fare. Dimmi cliente e lavoro, e partiamo.",
  ];
  return aperture[now.getDate() % aperture.length];
};
const UNIT_OPTIONS = [
  {value:"pz", label:"pz — Pezzo"},
  {value:"mq", label:"mq — Metro quadro"},
  {value:"ml", label:"ml — Metro lineare"},
  {value:"mc", label:"mc — Metro cubo"},
  {value:"ps", label:"ps — Peso (kg)"},
];
const PANEL_UNITS = ["mq","ml","mc"];

// Calcola le unità commerciali totali di un item
const calcItemUnits = (item) => {
  const qty = item.qty || 1;
  if (item.analysisUnit === "pz") return { total: qty, unit: "pz", label: `${qty} pz` };
  if (item.analysisUnit === "mq") {
    if (item.piecesAllEqual || !item.pieces?.length) {
      const mq = ((item.unitW||0)/100) * ((item.unitH||0)/100);
      return { total: mq * qty, unit: "mq", label: `${(mq*qty).toFixed(2)} mq (${qty}×${item.unitW}×${item.unitH}cm)` };
    } else {
      const total = item.pieces.reduce((s,p)=>s+(((p.w||0)/100)*((p.h||0)/100)),0);
      return { total, unit: "mq", label: `${total.toFixed(2)} mq (${item.pieces.length} pz misure diverse)` };
    }
  }
  if (item.analysisUnit === "ml") {
    if (item.piecesAllEqual || !item.pieces?.length) {
      const ml = (item.unitL||0)/100;
      return { total: ml * qty, unit: "ml", label: `${(ml*qty).toFixed(2)} ml (${qty}×${item.unitL}cm)` };
    } else {
      const total = item.pieces.reduce((s,p)=>s+((p.l||0)/100),0);
      return { total, unit: "ml", label: `${total.toFixed(2)} ml (${item.pieces.length} pz misure diverse)` };
    }
  }
  return { total: qty, unit: "pz", label: `${qty} pz` };
};

const fmt = n => "€\u00a0" + (n||0).toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2});
const today = () => new Date().toLocaleDateString("it-IT");

// ─── DEFAULT SETTINGS ─────────────────────────────────────────────────────────
const DEFAULT_FIGURES = [
  { id:"f1", name:"Progettista",      rate:45 },
  { id:"f2", name:"Operaio",          rate:28 },
  { id:"f3", name:"Operaio Esperto",  rate:35 },
  { id:"f4", name:"Op. Macchine",     rate:30 },
  { id:"f5", name:"Op. CNC",          rate:33 },
];

const DEFAULT_MACHINES = [
  { id:"m1", name:"Sezionatrice",           rate:18, defaultFigureId:"f4" },
  { id:"m2", name:"Nesting CNC",            rate:35, defaultFigureId:"f5" },
  { id:"m3", name:"Bordatrice",             rate:12, defaultFigureId:"f4" },
  { id:"m4", name:"Foratrice",              rate:10, defaultFigureId:"f4" },
  { id:"m5", name:"Centro di Lavoro CNC",   rate:45, defaultFigureId:"f5" },
  { id:"m6", name:"Tornio/Fresatrice",      rate:22, defaultFigureId:"f4" },
];

// Template fasi/sottofasi standard
const makeDefaultPhases = (figures, machines) => {
  const fig = (id) => figures.find(f=>f.id===id) || figures[0];
  const mach = (id) => machines.find(m=>m.id===id);
  return [
    {
      id: uid(), name: "Progettazione",
      subphases: [
        { id:uid(), name:"Disegno tecnico",   figureId:"f1", machineId:null, hours:0 },
        { id:uid(), name:"Modellazione 3D",   figureId:"f1", machineId:null, hours:0 },
        { id:uid(), name:"Documentazione",    figureId:"f1", machineId:null, hours:0 },
      ]
    },
    {
      id: uid(), name: "Macchinari",
      subphases: [
        { id:uid(), name:"Sezionatura",   figureId:"f4", machineId:"m1", hours:0 },
        { id:uid(), name:"Nesting",       figureId:"f5", machineId:"m2", hours:0 },
        { id:uid(), name:"Bordatura",     figureId:"f4", machineId:"m3", hours:0 },
        { id:uid(), name:"Foratura",      figureId:"f4", machineId:"m4", hours:0 },
        { id:uid(), name:"Lav. CNC",      figureId:"f5", machineId:"m5", hours:0 },
      ]
    },
    {
      id: uid(), name: "Falegnameria",
      subphases: [
        { id:uid(), name:"Premontaggio",        figureId:"f3", machineId:null, hours:0 },
        { id:uid(), name:"Lav. massello",       figureId:"f3", machineId:null, hours:0 },
        { id:uid(), name:"Assemblaggio",        figureId:"f2", machineId:null, hours:0 },
        { id:uid(), name:"Imballaggio",         figureId:"f2", machineId:null, hours:0 },
        { id:uid(), name:"Movimentazione",      figureId:"f2", machineId:null, hours:0 },
      ]
    },
    {
      id: uid(), name: "Finitura",
      subphases: [
        { id:uid(), name:"Carteggiatura",    figureId:"f2", machineId:null, hours:0 },
        { id:uid(), name:"Verniciatura",     figureId:"f3", machineId:null, hours:0 },
        { id:uid(), name:"Montaggio finale", figureId:"f3", machineId:null, hours:0 },
      ]
    },
  ];
};

// ─── FACTORIES ───────────────────────────────────────────────────────────────
const mkSp  = (figureId) => ({ id:uid(), name:"", figureId: figureId||"f2", machineId:null, hours:0 });
const mkPh  = (figures) => ({ id:uid(), name:"Nuova fase", subphases:[mkSp(figures[0]?.id)] });
const mkMat = () => ({ id:uid(), name:"", brand:"", category:"", subcategory:"", price:0, unit:"pz", qty:1, w:0, h:0, d:0, dbId:null });
const mkExt = () => ({ id:uid(), name:"", price:0, unit:"pz", qty:1 });
const mkItem= (settings) => ({
  id:uid(), name:"Nuovo Item", description:"", qty:1,
  analysisUnit: "pz",      // "pz" | "mq" | "ml"
  pieces: [],               // [{id, w, h, l}] — per pezzi con misure diverse
  piecesAllEqual: true,     // se false, ogni pezzo ha misure proprie
  unitW: 0, unitH: 0, unitL: 0, // misure standard (se tutti uguali)
  margins:{ produzione:null, materiali:null, esternalizzazioni:null },
  settings: JSON.parse(JSON.stringify(settings)),
  produzione:{ phases: makeDefaultPhases(settings.figures, settings.machines) },
  materiali:{ rows:[mkMat()] },
  esternalizzazioni:{ rows:[mkExt()] },
});
const DEFAULT_DB = [
  // Database vuoto — importa i tuoi articoli via CSV in ⚙ Impostazioni
  // Formato: name, category, subcategory, brand, unit, price, w, h, sp
];
const mkSettings = () => ({
  figures: DEFAULT_FIGURES.map(f=>({...f})),
  machines: DEFAULT_MACHINES.map(m=>({...m})),
  margins:{ produzione:30, materiali:25, esternalizzazioni:20 },
  db: DEFAULT_DB.map(d=>({...d})),
});
const mkProj = (settings) => ({
  id:uid(), name:"Nuovo Preventivo", client:"", date:today(), ref:"",
  settings: JSON.parse(JSON.stringify(settings)),
  items:[],
});

// ─── CALC ─────────────────────────────────────────────────────────────────────
const spCost = (sp, settings) => {
  const fig = settings.figures.find(f=>f.id===sp.figureId);
  const mac = sp.machineId ? settings.machines.find(m=>m.id===sp.machineId) : null;
  const rateH = (fig?.rate||0) + (mac?.rate||0);
  return (sp.hours||0) * rateH;
};
const effM = (item,cat) => item.margins[cat] !== null ? item.margins[cat] : item.settings?.margins?.[cat] ?? 30;

// We pass project settings into item calc
const cProd = (item,settings) => {
  let c=0;
  item.produzione.phases.forEach(ph=>ph.subphases.forEach(sp=>{c+=spCost(sp,settings);}));
  c*=(item.qty||1);
  const m=effM(item,"produzione");
  return{cost:c,price:c*(1+m/100)};
};
const matRowCost = (r) => {
  const qty = r.qty || 0;
  const price = r.price || 0;
  // w, h, d stored in mm → convert to m dividing by 1000
  if (r.unit === "mq") {
    const mq = ((r.w||0)/1000) * ((r.h||0)/1000);
    return qty * mq * price;
  }
  if (r.unit === "ml") return qty * (r.w||0)/1000 * price;
  if (r.unit === "mc") {
    const mc = ((r.w||0)/1000) * ((r.h||0)/1000) * ((r.d||0)/1000);
    return qty * mc * price;
  }
  return qty * price; // pz, ps or other
};
const cMat = (item) => {
  let c=0;
  item.materiali.rows.forEach(r=>{ c+=matRowCost(r); });
  c*=(item.qty||1);
  const m=effM(item,"materiali");
  return{cost:c,price:c*(1+m/100)};
};
const cExt = (item) => {
  let c=0;
  item.esternalizzazioni.rows.forEach(r=>{c+=(r.qty||0)*(r.price||0);});
  c*=(item.qty||1);
  const m=effM(item,"esternalizzazioni");
  return{cost:c,price:c*(1+m/100)};
};
const cItem = (item,settings) => {
  const pr=cProd(item,settings),ma=cMat(item),ex=cExt(item);
  return{pr,ma,ex,cost:pr.cost+ma.cost+ex.cost,price:pr.price+ma.price+ex.price};
};
const cProj = (proj) => {
  let cost=0,price=0,prP=0,maP=0,exP=0;
  proj.items.forEach(it=>{
    const c=cItem(it,proj.settings);
    cost+=c.cost;price+=c.price;prP+=c.pr.price;maP+=c.ma.price;exP+=c.ex.price;
  });
  return{cost,price,prP,maP,exP,margin:cost>0?(price-cost)/cost*100:0};
};

// ─── THEME ───────────────────────────────────────────────────────────────────
const T={
  bg:"#0d0e10",surf:"#141618",surf2:"#1a1d21",surf3:"#21252b",
  border:"#272b32",border2:"#333a44",
  text:"#e4e8f0",text2:"#8a93a6",text3:"#4e5666",
  red:"#c0392b",red2:"#e74c3c",
  blue:"#1e4d8c",blue2:"#3474d4",
  green:"#1a7a45",green2:"#27c068",
  yellow2:"#f0a020",
  orange:"#e67e22",
};

// ─── SPEECH UTILITIES ────────────────────────────────────────────────────────
const speak = (text, onStart, onEnd) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(fixPronunciation(text));
  utt.lang = "it-IT";
  utt.rate = 0.86;
  utt.pitch = 0.82;
  utt.volume = 1;

  // Aspetta che le voci siano caricate (necessario su alcuni browser)
  const setVoiceAndSpeak = () => {
    const voices = window.speechSynthesis.getVoices();
    // Priorità: voce italiana maschile → italiana generica → spagnola → default
    const itVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith("it"));
    // Preferisci voci MASCHILI italiane di qualità
    const maleNames = /cosimo|luca|diego|giuseppe|paolo|carlo|marco|roberto|male|maschile|uomo|man\b/i;
    const femaleNames = /alice|federica|elsa|paola|chiara|emma|giulia|female|femmin|donna|woman/i;
    const maleVoice = itVoices.find(v => maleNames.test(v.name))
                   || itVoices.find(v => !femaleNames.test(v.name) && !/compact|espeak/i.test(v.name))
                   || itVoices.find(v => !femaleNames.test(v.name));
    const premium = itVoices.find(v => !/compact|espeak/i.test(v.name));
    const best   = maleVoice || premium || itVoices[0] || null;
    if (best) utt.voice = best;
    if (onStart) utt.onstart = onStart;
    if (onEnd) { utt.onend = onEnd; utt.onerror = onEnd; }
    window.speechSynthesis.speak(utt);
  };

  // Su alcuni dispositivi le voci non sono subito disponibili
  if (window.speechSynthesis.getVoices().length > 0) {
    setVoiceAndSpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      setVoiceAndSpeak();
      window.speechSynthesis.onvoiceschanged = null;
    };
    setTimeout(setVoiceAndSpeak, 200);
  }
};

// Voce Orus via backend Gemini TTS (funziona dopo il deploy con /api/tts)
// Se l'endpoint non è disponibile (es. artifact), ripiega sulla voce di sistema
let _currentAudio = null;
const speakOrus = async (text, onStart, onEnd) => {
  if (!text) { onEnd && onEnd(); return; }
  // Ferma audio precedente
  if (_currentAudio) { try { _currentAudio.pause(); } catch(e){} _currentAudio = null; }
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error("tts endpoint non disponibile");
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("audio")) throw new Error("risposta non audio");
    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    _currentAudio = audio;
    audio.onplay  = () => onStart && onStart();
    audio.onended = () => { onEnd && onEnd(); URL.revokeObjectURL(audio.src); };
    audio.onerror = () => { onEnd && onEnd(); };
    await audio.play();
  } catch (e) {
    // Fallback: voce di sistema (Web Speech API)
    speak(text, onStart, onEnd);
  }
};

const stopOrus = () => {
  if (_currentAudio) { try { _currentAudio.pause(); } catch(e){} _currentAudio = null; }
  stopSpeaking();
};

// Chiamata unificata all'AI di Michi.
// Sul sito deployato usa il backend /api/michi (chiave protetta lato server).
// Dentro l'artifact di Claude usa la chiamata diretta (autorizzata lì).
const callMichi = async ({messages, system, max_tokens}) => {
  // Prova prima il backend (funziona sul sito online)
  try {
    const res = await fetch("/api/michi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system, max_tokens }),
    });
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const d = await res.json();
        if (d && d.content) return d; // risposta valida dal backend
      }
    }
  } catch (e) { /* backend non disponibile, passo al fallback */ }

  // Fallback: chiamata diretta (funziona dentro l'artifact)
  const body = { model: "claude-sonnet-4-6", max_tokens: max_tokens || 2000, messages };
  if (system) body.system = system;
  const res2 = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res2.json();
};

const stopSpeaking = () => { if (window.speechSynthesis) window.speechSynthesis.cancel(); };

// Hook for speech-to-text
const useSpeechInput = (onResult) => {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Il tuo browser non supporta il riconoscimento vocale. Usa Chrome."); return; }
    const rec = new SR();
    rec.lang = "it-IT";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart  = () => setListening(true);
    rec.onend    = () => setListening(false);
    rec.onerror  = () => setListening(false);
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      onResult(transcript);
    };
    recRef.current = rec;
    rec.start();
  }, [onResult]);

  const stop = useCallback(() => {
    if (recRef.current) recRef.current.stop();
    setListening(false);
  }, []);

  return { listening, start, stop };
};

// Mic button component
const MicBtn = ({onResult, style={}}) => {
  const [val, setVal] = useState("");
  const { listening, start, stop } = useSpeechInput((t) => { setVal(t); onResult(t); });
  return (
    <button
      onClick={listening ? stop : start}
      title={listening ? "Clicca per fermare" : "Parla"}
      style={{
        background: listening ? T.red2 : `${T.blue}22`,
        border: `1px solid ${listening ? T.red2 : T.blue}`,
        borderRadius: 5, cursor: "pointer", padding: "5px 8px",
        color: listening ? "#fff" : T.blue2, fontSize: 14,
        display: "flex", alignItems: "center", gap: 4,
        animation: listening ? "michi-dot 0.8s infinite" : "none",
        flexShrink: 0, ...style
      }}>
      {listening ? "⏹" : "🎤"}
    </button>
  );
};

// Speak button for Michi bubbles
const SpeakBtn = ({text}) => {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!window.speechSynthesis) setSupported(false);
  }, []);

  if (!text || !supported) return null;

  const handleClick = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    // Force resume in case speechSynthesis is paused (common iOS bug)
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(fixPronunciation(text));
    utt.lang = "it-IT";
    utt.rate = 0.86;
    utt.pitch = 0.82;
    utt.volume = 1;

    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const itVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith("it"));
      // Preferisci voci italiane di qualità (non eSpeak/Compact)
      const maleNames = /cosimo|luca|diego|giuseppe|paolo|carlo|marco|roberto|male|maschile|uomo|man\b/i;
      const femaleNames = /alice|federica|elsa|paola|chiara|emma|giulia|female|femmin|donna|woman/i;
      const maleVoice = itVoices.find(v => maleNames.test(v.name))
                     || itVoices.find(v => !femaleNames.test(v.name) && !/compact|espeak/i.test(v.name))
                     || itVoices.find(v => !femaleNames.test(v.name));
      const premium = itVoices.find(v => !/compact|espeak/i.test(v.name));
      const best = maleVoice || premium || itVoices[0] || voices[0] || null;
      if (best) utt.voice = best;
      utt.onstart  = () => setSpeaking(true);
      utt.onend    = () => setSpeaking(false);
      utt.onerror  = (e) => { console.warn("Speech error:", e); setSpeaking(false); };
      window.speechSynthesis.speak(utt);

      // iOS workaround: speechSynthesis stops after ~15s, keep it alive
      const keepAlive = setInterval(() => {
        if (!window.speechSynthesis.speaking) { clearInterval(keepAlive); return; }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10000);
      utt.onend = () => { clearInterval(keepAlive); setSpeaking(false); };
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      trySpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => { trySpeak(); window.speechSynthesis.onvoiceschanged = null; };
      setTimeout(trySpeak, 300);
    }
  };

  return (
    <button onClick={handleClick}
      style={{
        background: speaking ? T.blue2 : `${T.blue}22`,
        border: `1px solid ${T.blue2}`,
        borderRadius: 14, cursor: "pointer",
        padding: "5px 14px",
        color: speaking ? "#fff" : T.blue2,
        fontSize: 12, fontWeight: 600,
        fontFamily: "'IBM Plex Sans', sans-serif",
        display: "inline-flex", alignItems: "center", gap: 5,
      }}>
      <span style={{fontSize:14}}>{speaking ? "⏹" : "🔊"}</span>
      {speaking ? "Stop" : "Ascolta Michi"}
    </button>
  );
};

const CSS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:${T.bg};color:${T.text};font-family:'IBM Plex Sans',sans-serif;font-size:14px;-webkit-text-size-adjust:100%;}
    ::-webkit-scrollbar{width:3px;height:3px;}
    ::-webkit-scrollbar-thumb{background:${T.border2};border-radius:2px;}
    input[type=number]::-webkit-inner-spin-button{opacity:.3;}
    select option{background:${T.surf2};}
    @keyframes michi-dot{0%,80%,100%{transform:scale(0.6);opacity:0.4}40%{transform:scale(1);opacity:1}} @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  `}</style>
);

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
const Lbl = ({c,style={}}) => (
  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3,
    textTransform:"uppercase",letterSpacing:"1.5px",...style}}>{c}</div>
);

const Inp = ({value,onChange,onFocus:onFocusProp,placeholder,type="text",min,step,style={},rows}) => {
  const base = {
    width:"100%",background:T.surf3,border:`1px solid ${T.border2}`,
    borderRadius:5,color:T.text,padding:"6px 9px",outline:"none",
    fontFamily:type==="number"?"'IBM Plex Mono',monospace":"'IBM Plex Sans',sans-serif",
    textAlign:type==="number"?"right":"left",...style
  };
  const f=e=>{ e.target.style.borderColor=T.blue2; if(onFocusProp) onFocusProp(e); };
  const b=e=>e.target.style.borderColor=T.border2;
  if (rows) return (
    <textarea value={value} onChange={e=>onChange(e.target.value)}
      placeholder={placeholder} rows={rows}
      style={{...base,resize:"vertical",lineHeight:1.5}} onFocus={f} onBlur={b}/>
  );
  return (
    <input type={type} value={value} min={min} step={step} placeholder={placeholder}
      onChange={e=>onChange(type==="number"?(parseFloat(e.target.value)||0):e.target.value)}
      style={base} onFocus={f} onBlur={b}/>
  );
};

const Sel = ({value,onChange,options,placeholder}) => (
  <select value={value||""} onChange={e=>onChange(e.target.value||null)}
    style={{width:"100%",background:T.surf3,border:`1px solid ${T.border2}`,
      borderRadius:5,color:value?T.text:T.text3,padding:"6px 9px",
      outline:"none",fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o=>(
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

const Btn = ({onClick,children,v="ghost",style={},disabled=false}) => {
  const vs = {
    primary:{background:T.blue,color:"#fff",border:"none"},
    danger: {background:"transparent",color:T.red2,border:`1px solid ${T.red}44`},
    ghost:  {background:"transparent",color:T.text2,border:`1px solid ${T.border2}`},
    ai:     {background:`${T.blue}22`,color:T.blue2,border:`1px solid ${T.blue}`},
    ok:     {background:T.green,color:"#fff",border:"none"},
    warn:   {background:`${T.orange}22`,color:T.orange,border:`1px solid ${T.orange}44`},
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{...vs[v],borderRadius:5,cursor:disabled?"not-allowed":"pointer",
        padding:"5px 11px",fontSize:12,fontWeight:600,
        display:"inline-flex",alignItems:"center",gap:4,
        opacity:disabled?.5:1,whiteSpace:"nowrap",...style}}>
      {children}
    </button>
  );
};

const AddBtn = ({onClick,color,children}) => (
  <button onClick={onClick}
    style={{width:"100%",marginTop:6,padding:"7px",borderRadius:5,cursor:"pointer",
      background:`${color}18`,border:`1px dashed ${color}`,color,
      fontSize:12,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
    {children}
  </button>
);

const Card = ({children,style={}}) => (
  <div style={{background:T.surf,border:`1px solid ${T.border}`,borderRadius:8,...style}}>
    {children}
  </div>
);

// ─── MARGIN BAR ───────────────────────────────────────────────────────────────
const MBar = ({item,cat,color,onChange}) => {
  const gm = item.settings?.margins?.[cat] ?? 30;
  const isOv = item.margins[cat] !== null;
  const val = isOv ? item.margins[cat] : gm;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
      background:T.surf2,border:`1px solid ${T.border}`,borderRadius:6,
      padding:"7px 10px",marginBottom:10}}>
      <Lbl c="Margine"/>
      <div style={{display:"flex",alignItems:"center",gap:3,background:T.surf3,
        border:`1px solid ${T.border2}`,borderRadius:4,padding:"3px 8px"}}>
        <input type="number" min={0} max={999} value={val}
          onChange={e => onChange(p=>({...p,margins:{...p.margins,[cat]:parseFloat(e.target.value)||0}}))}
          style={{background:"none",border:"none",outline:"none",color,
            fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:500,
            width:46,textAlign:"right"}}/>
        <span style={{color:T.text3,fontFamily:"'IBM Plex Mono',monospace",fontSize:12}}>%</span>
      </div>
      {isOv
        ? <>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,
              background:`${T.red}22`,color:T.red2,border:`1px solid ${T.red}44`,
              borderRadius:3,padding:"2px 5px",letterSpacing:1}}>OVERRIDE</span>
            <Btn v="ghost" style={{fontSize:10,padding:"2px 7px"}}
              onClick={()=>onChange(p=>({...p,margins:{...p.margins,[cat]:null}}))}>
              ↩ Reset
            </Btn>
          </>
        : <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3}}>GLOBALE</span>
      }
    </div>
  );
};

// ─── PRODUZIONE SECTION ───────────────────────────────────────────────────────
const ProduzioneSection = ({item,onChange}) => {
  const [open,setOpen] = useState(true);
  const [openPh,setOpenPh] = useState({});
  const settings = item.settings;
  const calc = cProd(item,settings);

  const figureOpts  = settings.figures.map(f=>({value:f.id,label: f.name + " (" + f.rate + " eur/h)"}));
  const machineOpts = [
    {value:"",label:"— nessuna macchina —"},
    ...settings.machines.map(m=>({value:m.id,label: m.name + " (+" + m.rate + " eur/h)"}))
  ];

  const updSp = (phId,spId,key,val) => onChange(p=>({
    ...p,
    produzione:{phases:p.produzione.phases.map(ph=>
      ph.id!==phId ? ph : {
        ...ph,
        subphases:ph.subphases.map(sp => {
          if (sp.id!==spId) return sp;
          const upd = {...sp,[key]:val};
          // When machine changes, auto-set the default figure
          if (key==="machineId" && val) {
            const mac = p.settings.machines.find(m=>m.id===val);
            if (mac?.defaultFigureId) upd.figureId = mac.defaultFigureId;
          }
          return upd;
        })
      }
    )}
  }));

  const addSp  = phId => onChange(p=>({...p,produzione:{phases:p.produzione.phases.map(ph=>
    ph.id!==phId ? ph : {...ph,subphases:[...ph.subphases,mkSp(p.settings.figures[0]?.id)]}
  )}}));
  const remSp  = (phId,spId) => onChange(p=>({...p,produzione:{phases:p.produzione.phases.map(ph=>
    ph.id!==phId ? ph : {...ph,subphases:ph.subphases.filter(sp=>sp.id!==spId)}
  )}}));
  const updPh  = (phId,val) => onChange(p=>({...p,produzione:{phases:p.produzione.phases.map(ph=>
    ph.id!==phId ? ph : {...ph,name:val}
  )}}));
  const addPh  = () => onChange(p=>({...p,produzione:{phases:[...p.produzione.phases,mkPh(p.settings.figures)]}}));
  const remPh  = phId => onChange(p=>({...p,produzione:{phases:p.produzione.phases.filter(ph=>ph.id!==phId)}}));

  return (
    <Card style={{marginBottom:10,overflow:"hidden"}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:"10px 14px",display:"flex",alignItems:"center",
          justifyContent:"space-between",cursor:"pointer",userSelect:"none",
          borderBottom:open?`1px solid ${T.border}`:"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,fontWeight:600,fontSize:13}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:T.blue2,display:"inline-block"}}/>
          PRODUZIONE
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,
          fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
          <span style={{color:T.text2}}>{fmt(calc.cost)}</span>
          <span style={{color:T.blue2,fontWeight:600}}>{fmt(calc.price)}</span>
          <span style={{color:T.text3}}>{open?"▾":"▸"}</span>
        </div>
      </div>

      {open && (
        <div style={{padding:"12px 14px"}}>
          <MBar item={item} cat="produzione" color={T.blue2} onChange={onChange}/>

          {item.produzione.phases.map(ph => {
            const phOpen = openPh[ph.id] !== false;
            const phCost = ph.subphases.reduce((s,sp)=>s+spCost(sp,settings),0)*(item.qty||1);

            return (
              <div key={ph.id} style={{border:`1px solid ${T.border}`,borderRadius:6,marginBottom:8,overflow:"hidden"}}>
                {/* Phase header */}
                <div style={{background:T.surf2,padding:"8px 10px",
                  display:"flex",alignItems:"center",gap:6}}>
                  <span onClick={()=>setOpenPh(p=>({...p,[ph.id]:!phOpen}))}
                    style={{cursor:"pointer",color:T.text3,fontSize:12,userSelect:"none",flexShrink:0}}>
                    {phOpen?"▾":"▸"}
                  </span>
                  <input value={ph.name} onChange={e=>updPh(ph.id,e.target.value)}
                    style={{flex:1,background:"none",border:"none",outline:"none",
                      color:T.text,fontFamily:"'IBM Plex Sans',sans-serif",
                      fontSize:13,fontWeight:600}}
                    placeholder="Nome fase…"/>
                  <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:T.text3,flexShrink:0}}>
                    {fmt(phCost)}
                  </span>
                  <button onClick={()=>remPh(ph.id)}
                    style={{background:"none",border:"none",cursor:"pointer",
                      color:T.text3,fontSize:13,padding:"0 2px",flexShrink:0}}>✕</button>
                </div>

                {phOpen && (
                  <div style={{padding:8}}>
                    {/* Column headers */}
                    <div style={{display:"grid",
                      gridTemplateColumns:"1.2fr 1fr 1fr 60px 80px 22px",
                      gap:5,paddingBottom:6,borderBottom:`1px solid ${T.border}`,marginBottom:6}}>
                      {["Operazione","Figura","Macchina","Ore×1","Totale",""].map((l,i)=>(
                        <Lbl key={i} c={l}/>
                      ))}
                    </div>

                    {ph.subphases.map(sp => {
                      const fig = settings.figures.find(f=>f.id===sp.figureId);
                      const mac = sp.machineId ? settings.machines.find(m=>m.id===sp.machineId) : null;
                      const rateH = (fig?.rate||0)+(mac?.rate||0);
                      const tot = (sp.hours||0)*rateH*(item.qty||1);

                      return (
                        <div key={sp.id} style={{display:"grid",
                          gridTemplateColumns:"1.2fr 1fr 1fr 60px 80px 22px",
                          gap:5,marginBottom:6,alignItems:"start"}}>

                          {/* Name */}
                          <Inp value={sp.name} onChange={v=>updSp(ph.id,sp.id,"name",v)}
                            placeholder="es. Sezionatura…"/>

                          {/* Figure */}
                          <Sel value={sp.figureId} options={figureOpts}
                            onChange={v=>updSp(ph.id,sp.id,"figureId",v)}/>

                          {/* Machine */}
                          <Sel value={sp.machineId||""} options={machineOpts}
                            onChange={v=>updSp(ph.id,sp.id,"machineId",v||null)}/>

                          {/* Hours */}
                          <Inp type="number" value={sp.hours} min={0} step={0.5}
                            onChange={v=>updSp(ph.id,sp.id,"hours",v)}/>

                          {/* Total + rate tooltip */}
                          <div style={{textAlign:"right"}}>
                            <div style={{fontFamily:"'IBM Plex Mono',monospace",
                              fontSize:11,color:T.text2}}>{fmt(tot)}</div>
                            <div style={{fontFamily:"'IBM Plex Mono',monospace",
                              fontSize:9,color:T.text3,marginTop:1}}>
                              €{rateH}/h
                              {mac && <span style={{color:T.orange}}> ⚙</span>}
                            </div>
                          </div>

                          <button onClick={()=>remSp(ph.id,sp.id)}
                            style={{background:"none",border:"none",cursor:"pointer",
                              color:T.text3,fontSize:13,paddingTop:4}}>✕</button>
                        </div>
                      );
                    })}

                    <AddBtn onClick={()=>addSp(ph.id)} color={T.blue2}>
                      + sottofase
                    </AddBtn>
                  </div>
                )}
              </div>
            );
          })}

          <AddBtn onClick={addPh} color={T.blue2}>+ Aggiungi fase</AddBtn>
        </div>
      )}
    </Card>
  );
};

// ─── MAT ROW (with DB search) ────────────────────────────────────────────────
const MatRow = ({r, item, onUpd, onRem, onSaveToDb}) => {
  const db = item.settings?.db || [];
  const [step, setStep] = useState(r.name ? "done" : "cat"); 
  // step: "cat" | "search" | "done"
  const [catFilter, setCatFilter]   = useState(r.category || "");
  const [subFilter, setSubFilter]   = useState(r.subcategory || "");
  const [searchText, setSearchText] = useState("");
  const [showPriceDialog, setShowPriceDialog] = useState(false);
  const [pendingPrice, setPendingPrice] = useState(null);

  // Derived lists
  const categories   = [...new Set(db.map(d=>d.category).filter(Boolean))].sort();
  const subcategories = catFilter
    ? [...new Set(db.filter(d=>d.category===catFilter).map(d=>d.subcategory).filter(Boolean))].sort()
    : [];
  const filteredItems = db.filter(d => {
    const matchCat = !catFilter || d.category === catFilter;
    const matchSub = !subFilter || d.subcategory === subFilter;
    const matchTxt = !searchText || d.name.toLowerCase().includes(searchText.toLowerCase())
      || (d.brand||"").toLowerCase().includes(searchText.toLowerCase());
    return matchCat && matchSub && matchTxt;
  });

  const selectItem = (d) => {
    onUpd(r.id, "__fromDb", d);
    setStep("done");
  };

  const createNew = () => {
    // populate with whatever we have so far
    onUpd(r.id, "__new", {
      category: catFilter, subcategory: subFilter, name: searchText
    });
    setStep("done");
  };

  const handlePriceChange = (v) => {
    if (r.dbId) {
      setPendingPrice(v);
      setShowPriceDialog(true);
    } else {
      onUpd(r.id,"price",v);
    }
  };

  const isPanelUnit = PANEL_UNITS.includes(r.unit);
  const tot = matRowCost(r) * (item.qty||1);

  // ── STEP: CATEGORY ──────────────────────────────────────────────────────────
  if (step === "cat") return (
    <div style={{marginBottom:8,background:T.surf2,borderRadius:6,padding:"10px 12px",
      border:`1px solid ${T.border}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <Lbl c="Nuovo Materiale — Categoria"/>
        <button onClick={()=>onRem(r.id)}
          style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:13}}>✕</button>
      </div>

      {/* Category */}
      <div style={{marginBottom:6}}>
        <Lbl c="Categoria" style={{marginBottom:3}}/>
        {categories.length > 0 && (
          <select value={catFilter} onChange={e=>{ setCatFilter(e.target.value); setSubFilter(""); }}
            style={{width:"100%",background:T.surf3,border:`1px solid ${T.border2}`,borderRadius:5,
              color:catFilter?T.text:T.text3,padding:"6px 9px",outline:"none",marginBottom:5,
              fontFamily:"'IBM Plex Sans',sans-serif",fontSize:13}}>
            <option value="">— Seleziona dal database —</option>
            {categories.map(c=><option key={c} value={c} style={{background:T.surf2}}>{c}</option>)}
          </select>
        )}
        <Inp value={catFilter} onChange={v=>{ setCatFilter(v); setSubFilter(""); }}
          placeholder="Scrivi categoria…"/>
      </div>

      {/* Subcategory */}
      <div style={{marginBottom:8}}>
        <Lbl c="Sottocategoria (opzionale)" style={{marginBottom:3}}/>
        {subcategories.length > 0 && (
          <select value={subFilter} onChange={e=>setSubFilter(e.target.value)}
            style={{width:"100%",background:T.surf3,border:`1px solid ${T.border2}`,borderRadius:5,
              color:subFilter?T.text:T.text3,padding:"6px 9px",outline:"none",marginBottom:5,
              fontFamily:"'IBM Plex Sans',sans-serif",fontSize:13}}>
            <option value="">— Seleziona sottocategoria —</option>
            {subcategories.map(s=><option key={s} value={s} style={{background:T.surf2}}>{s}</option>)}
          </select>
        )}
        <Inp value={subFilter} onChange={v=>setSubFilter(v)} placeholder="Scrivi sottocategoria…"/>
      </div>

      <div style={{display:"flex",gap:6,marginTop:8}}>
        <Btn v="primary" onClick={()=>setStep("search")} style={{flex:1,justifyContent:"center"}}>
          Avanti →
        </Btn>
        <Btn v="ghost" onClick={createNew} style={{fontSize:11}}>
          Scrivi libero
        </Btn>
      </div>
    </div>
  );

  // ── STEP: SEARCH ────────────────────────────────────────────────────────────
  if (step === "search") return (
    <div style={{marginBottom:8,background:T.surf2,borderRadius:6,padding:"10px 12px",
      border:`1px solid ${T.border}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div>
          <Lbl c="Cerca Articolo"/>
          {(catFilter||subFilter) && (
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.blue2,marginTop:2,display:"block"}}>
              {catFilter}{subFilter?` / ${subFilter}`:""}
            </span>
          )}
        </div>
        <div style={{display:"flex",gap:5}}>
          <Btn v="ghost" style={{fontSize:10,padding:"2px 7px"}} onClick={()=>setStep("cat")}>← Cat.</Btn>
          <button onClick={()=>onRem(r.id)}
            style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:13}}>✕</button>
        </div>
      </div>

      <Inp value={searchText} onChange={setSearchText}
        placeholder="Cerca per nome o marca…" style={{marginBottom:8}}/>

      {/* Results */}
      <div style={{maxHeight:220,overflowY:"auto",borderRadius:5,
        border:`1px solid ${T.border}`,overflow:"hidden"}}>
        {filteredItems.length > 0
          ? filteredItems.slice(0,8).map(d => (
              <div key={d.id} onClick={()=>selectItem(d)}
                style={{padding:"8px 10px",cursor:"pointer",
                  borderBottom:`1px solid ${T.border}`,
                  transition:"background .1s"}}
                onMouseEnter={e=>e.currentTarget.style.background=T.surf3}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{fontSize:13,fontWeight:500,color:T.text}}>{d.name}</div>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3,marginTop:2,
                  display:"flex",gap:8}}>
                  {d.brand && <span>{d.brand}</span>}
                  <span>{d.category}{d.subcategory?` / ${d.subcategory}`:""}</span>
                  <span style={{color:T.green2}}>{fmt(d.price)}/{d.unit}</span>
                </div>
              </div>
            ))
          : (
            <div style={{padding:"12px 10px",color:T.text3,fontSize:12,textAlign:"center"}}>
              Nessun articolo trovato
            </div>
          )
        }
      </div>

      {/* Create new */}
      <div style={{marginTop:8,padding:"8px 10px",background:`${T.orange}12`,
        border:`1px dashed ${T.orange}44`,borderRadius:5}}>
        <div style={{fontSize:11,color:T.text3,marginBottom:5}}>
          Articolo non presente? Aggiungilo:
        </div>
        <Btn v="warn" style={{width:"100%",justifyContent:"center"}} onClick={createNew}>
          + Crea nuovo articolo
        </Btn>
      </div>
    </div>
  );

  // ── STEP: DONE (editing) ────────────────────────────────────────────────────
  return (
    <div style={{marginBottom:8,background:T.surf2,borderRadius:6,padding:"8px 10px",
      border:`1px solid ${r.dbId ? T.blue+"44" : T.border}`}}>

      {/* Header: name + actions */}
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:r.brand?4:6}}>
        <div style={{flex:1,fontWeight:600,fontSize:13,color:T.text,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {r.name || <span style={{color:T.text3,fontStyle:"italic"}}>Senza nome</span>}
        </div>
        {r.dbId && (
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.blue2,
            background:`${T.blue}22`,borderRadius:3,padding:"2px 5px",flexShrink:0}}>DB</span>
        )}
        <Btn v="ghost" style={{fontSize:10,padding:"2px 6px"}} onClick={()=>setStep("cat")}>
          ✎
        </Btn>
        <button onClick={()=>onRem(r.id)}
          style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:14}}>✕</button>
      </div>

      {/* Category info (read-only display) */}
      {(r.category||r.subcategory) && (
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3,marginBottom:6}}>
          {r.category && <span>{r.category}{r.subcategory?` / ${r.subcategory}`:""}</span>}
        </div>
      )}

      {/* Name — always editable */}
      <div style={{marginBottom:6}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
          <Lbl c="Nome articolo"/>
          <MicBtn onResult={v=>onUpd(r.id,"name",v)} style={{padding:"3px 6px",fontSize:11}}/>
        </div>
        <Inp value={r.name||""} onChange={v=>onUpd(r.id,"name",v)} placeholder="Scrivi nome articolo…"/>
      </div>
      {/* Brand — editable */}
      <div style={{marginBottom:6}}>
        <Lbl c="Marca (opzionale)" style={{marginBottom:3}}/>
        <Inp value={r.brand||""} onChange={v=>onUpd(r.id,"brand",v)} placeholder="Marca…"/>
      </div>

      {/* Fields grid */}
      <div style={{display:"grid",
        gridTemplateColumns: r.unit==="mc" ? "65px 50px 55px 50px 50px 45px" : isPanelUnit ? "65px 50px 55px 50px 50px" : "65px 50px 70px",
        gap:5,alignItems:"end",marginBottom:isPanelUnit?4:0}}>

        <div>
          <Lbl c="€/unità" style={{marginBottom:2}}/>
          <Inp type="number" value={r.price||0} min={0} step={0.01} onChange={handlePriceChange}/>
        </div>

        <div>
          <Lbl c="Unità" style={{marginBottom:2}}/>
          <select value={r.unit||"pz"} onChange={e=>onUpd(r.id,"unit",e.target.value)}
            style={{width:"100%",background:T.surf3,border:`1px solid ${T.border2}`,
              borderRadius:5,color:T.text,padding:"6px 4px",outline:"none",
              fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
            {UNIT_OPTIONS.map(u=>(
              <option key={u.value} value={u.value} style={{background:T.surf2}}>{u.value}</option>
            ))}
          </select>
        </div>

        <div>
          <Lbl c={r.unit==="mq"||r.unit==="mc"?"N.pann.":r.unit==="ml"?"N.pz":"Qtà×1"} style={{marginBottom:2}}/>
          <Inp type="number" value={r.qty||1} min={0} step={1} onChange={v=>onUpd(r.id,"qty",v)}/>
        </div>

        {isPanelUnit && (
          <div>
            <Lbl c={r.unit==="ml"?"Lung.cm":"Larg.cm"} style={{marginBottom:2}}/>
            <Inp type="number" value={r.w||0} min={0} step={1} onChange={v=>onUpd(r.id,"w",v)}/>
          </div>
        )}
        {(r.unit==="mq"||r.unit==="mc") && (
          <div>
            <Lbl c="Alt.cm" style={{marginBottom:2}}/>
            <Inp type="number" value={r.h||0} min={0} step={1} onChange={v=>onUpd(r.id,"h",v)}/>
          </div>
        )}
        {r.unit==="mc" && (
          <div>
            <Lbl c="Prof.cm" style={{marginBottom:2}}/>
            <Inp type="number" value={r.d||0} min={0} step={1} onChange={v=>onUpd(r.id,"d",v)}/>
          </div>
        )}
      </div>

      {/* Panel computed + total */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3}}>
          {r.unit==="mq" && `${(((r.w||0)/1000)*((r.h||0)/1000)*(r.qty||0)).toFixed(2)} mq totali`}
          {r.unit==="ml" && `${(((r.w||0)/1000)*(r.qty||0)).toFixed(2)} ml totali`}
          {r.unit==="mc" && `${(((r.w||0)/1000)*((r.h||0)/1000)*((r.d||0)/1000)*(r.qty||0)).toFixed(3)} mc totali`}
          {r.unit==="ps" && `${r.qty||0} kg`}
        </span>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,
          color:T.green2,fontWeight:600}}>{fmt(tot)}</span>
      </div>

      {/* Save to DB prompt (for new items not in db) */}
      {!r.dbId && r.name && (
        <div style={{marginTop:6,display:"flex",alignItems:"center",justifyContent:"space-between",
          padding:"5px 8px",background:`${T.orange}10`,borderRadius:4,
          border:`1px dashed ${T.orange}33`}}>
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.orange}}>
            Non nel database
          </span>
          <Btn v="warn" style={{fontSize:10,padding:"2px 8px"}}
            onClick={()=>onSaveToDb({
              name:r.name, brand:r.brand||"", category:r.category||"Altro",
              subcategory:r.subcategory||"Altro", unit:r.unit, price:r.price,
              w:r.w||0, h:r.h||0, d:r.d||0
            })}>
            + Salva nel database
          </Btn>
        </div>
      )}

      {/* Price change dialog */}
      {showPriceDialog && (
        <div style={{marginTop:8,background:`${T.blue}14`,border:`1px solid ${T.blue}44`,
          borderRadius:5,padding:"8px 10px"}}>
          <div style={{fontSize:12,color:T.text2,marginBottom:6}}>
            Prezzo modificato: {fmt(r.price)} → {fmt(pendingPrice)}
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            <Btn v="ok" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>{
              onUpd(r.id,"price",pendingPrice);
              onSaveToDb({id:r.dbId, price:pendingPrice});
              setShowPriceDialog(false); setPendingPrice(null);
            }}>✓ Aggiorna database</Btn>
            <Btn v="ghost" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>{
              onUpd(r.id,"price",pendingPrice);
              setShowPriceDialog(false); setPendingPrice(null);
            }}>Solo preventivo</Btn>
            <Btn v="danger" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>{
              setShowPriceDialog(false); setPendingPrice(null);
            }}>Annulla</Btn>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── MATERIALI ────────────────────────────────────────────────────────────────
const MatSection = ({item, onChange, onUpdateDb}) => {
  const [open,setOpen] = useState(true);
  const calc = cMat(item);

  const upd = (id, k, v) => {
    if (k === "__fromDb") {
      const d = v;
      onChange(p => ({...p, materiali:{rows:p.materiali.rows.map(r =>
        r.id !== id ? r : {
          ...r, name:d.name, brand:d.brand||"", category:d.category||"",
          subcategory:d.subcategory||"", price:d.price||0,
          unit:d.unit||"pz", w:d.w||0, h:d.h||0, d:d.d||0, dbId:d.id
        }
      )}}));
    } else if (k === "__new") {
      const d = v;
      onChange(p => ({...p, materiali:{rows:p.materiali.rows.map(r =>
        r.id !== id ? r : {
          ...r, category:d.category||"", subcategory:d.subcategory||"",
          name:d.name||"", dbId:null
        }
      )}}));
    } else {
      onChange(p => ({...p, materiali:{rows:p.materiali.rows.map(r =>
        r.id !== id ? r : {...r, [k]: v}
      )}}));
    }
  };

  const add = () => onChange(p=>({...p,materiali:{rows:[...p.materiali.rows,mkMat()]}}));
  const rem = id => onChange(p=>({...p,materiali:{rows:p.materiali.rows.filter(r=>r.id!==id)}}));

  const saveToDb = (dbItem) => {
    if (onUpdateDb) onUpdateDb(dbItem);
  };

  return (
    <Card style={{marginBottom:10,overflow:"hidden"}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:"10px 14px",display:"flex",alignItems:"center",
          justifyContent:"space-between",cursor:"pointer",userSelect:"none",
          borderBottom:open?`1px solid ${T.border}`:"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,fontWeight:600,fontSize:13}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:T.green2,display:"inline-block"}}/>
          MATERIALI
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
          <span style={{color:T.text2}}>{fmt(calc.cost)}</span>
          <span style={{color:T.green2,fontWeight:600}}>{fmt(calc.price)}</span>
          <span style={{color:T.text3}}>{open?"▾":"▸"}</span>
        </div>
      </div>
      {open && (
        <div style={{padding:"12px 14px"}}>
          <MBar item={item} cat="materiali" color={T.green2} onChange={onChange}/>
          {item.materiali.rows.map(r => (
            <MatRow key={r.id} r={r} item={item}
              onUpd={upd} onRem={rem} onSaveToDb={saveToDb}/>
          ))}
          <AddBtn onClick={add} color={T.green2}>+ Aggiungi materiale</AddBtn>
        </div>
      )}
    </Card>
  );
};

// ─── ESTERNALIZZAZIONI ────────────────────────────────────────────────────────
const ExtSection = ({item,onChange}) => {
  const [open,setOpen] = useState(true);
  const calc = cExt(item);
  const upd = (id,k,v) => onChange(p=>({...p,esternalizzazioni:{rows:p.esternalizzazioni.rows.map(r=>r.id!==id?r:{...r,[k]:v})}}));
  const add = () => onChange(p=>({...p,esternalizzazioni:{rows:[...p.esternalizzazioni.rows,mkExt()]}}));
  const rem = id => onChange(p=>({...p,esternalizzazioni:{rows:p.esternalizzazioni.rows.filter(r=>r.id!==id)}}));

  return (
    <Card style={{marginBottom:10,overflow:"hidden"}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:"10px 14px",display:"flex",alignItems:"center",
          justifyContent:"space-between",cursor:"pointer",userSelect:"none",
          borderBottom:open?`1px solid ${T.border}`:"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,fontWeight:600,fontSize:13}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:T.yellow2,display:"inline-block"}}/>
          ESTERNALIZZAZIONI
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
          <span style={{color:T.text2}}>{fmt(calc.cost)}</span>
          <span style={{color:T.yellow2,fontWeight:600}}>{fmt(calc.price)}</span>
          <span style={{color:T.text3}}>{open?"▾":"▸"}</span>
        </div>
      </div>
      {open && (
        <div style={{padding:"12px 14px"}}>
          <MBar item={item} cat="esternalizzazioni" color={T.yellow2} onChange={onChange}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 75px 48px 65px 75px 22px",
            gap:5,paddingBottom:6,borderBottom:`1px solid ${T.border}`,marginBottom:6}}>
            {["Attività","€/un.","Unità","Qtà×1","Totale",""].map((l,i)=><Lbl key={i} c={l}/>)}
          </div>
          {item.esternalizzazioni.rows.map(r => {
            const tot=(r.qty||0)*(r.price||0)*(item.qty||1);
            return (
              <div key={r.id} style={{display:"grid",
                gridTemplateColumns:"1fr 75px 48px 65px 75px 22px",
                gap:5,marginBottom:5,alignItems:"center"}}>
                <Inp value={r.name} onChange={v=>upd(r.id,"name",v)} placeholder="es. Verniciatura…"/>
                <Inp type="number" value={r.price} min={0} step={0.01} onChange={v=>upd(r.id,"price",v)}/>
                <Inp value={r.unit} onChange={v=>upd(r.id,"unit",v)} style={{textAlign:"center"}}/>
                <Inp type="number" value={r.qty} min={0} step={0.01} onChange={v=>upd(r.id,"qty",v)}/>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,
                  color:T.text2,textAlign:"right"}}>{fmt(tot)}</span>
                <button onClick={()=>rem(r.id)}
                  style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:13}}>✕</button>
              </div>
            );
          })}
          <AddBtn onClick={add} color={T.yellow2}>+ Aggiungi esternalizzazione</AddBtn>
        </div>
      )}
    </Card>
  );
};

// ─── AI BOX ───────────────────────────────────────────────────────────────────
const AIBox = ({itemName,description,onAccept}) => {
  const [show,setShow] = useState(false);
  const [loading,setLoading] = useState(false);
  const [text,setText] = useState("");

  const run = async mode => {
    if (!description.trim()) { setText("⚠ Scrivi prima una descrizione."); setShow(true); return; }
    const prompts = {
      fix:`Correggi grammatica e ortografia di questa descrizione tecnica di arredo "${itemName}". Restituisci SOLO il testo corretto.\n\n${description}`,
      expand:`Espandi questa descrizione tecnica di arredo "${itemName}" aggiungendo dettagli tecnici (materiali, finiture, dimensioni indicative). Tono professionale. SOLO testo espanso.\n\n${description}`,
      formal:`Riscrivi in italiano tecnico formale per preventivo professionale. Arredo: "${itemName}". SOLO testo riscritto.\n\n${description}`,
    };
    setLoading(true); setText("⟳ Elaborazione…"); setShow(true);
    try {
      const d = await callMichi({max_tokens:800, messages:[{role:"user",content:prompts[mode]}]});
      setText(d.content?.find(b=>b.type==="text")?.text?.trim()||"Errore risposta.");
    } catch(e) { setText("✕ Errore: "+e.message); }
    finally { setLoading(false); }
  };

  const ok = !loading&&!text.startsWith("⚠")&&!text.startsWith("✕")&&!text.startsWith("⟳");
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        marginBottom:5,flexWrap:"wrap",gap:4}}>
        <Lbl c="Descrizione"/>
        <div style={{display:"flex",gap:4}}>
          <Btn v="ai" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>run("fix")} disabled={loading}>✦ Correggi</Btn>
          <Btn v="ai" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>run("expand")} disabled={loading}>✦ Espandi</Btn>
          <Btn v="ai" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>run("formal")} disabled={loading}>✦ Formalizza</Btn>
        </div>
      </div>
      {show && (
        <div style={{marginBottom:8,background:T.surf3,border:`1px solid ${T.blue}`,
          borderRadius:6,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"6px 10px",background:`${T.blue}22`,borderBottom:`1px solid ${T.border}`}}>
            <Lbl c="✦ Suggerimento AI" style={{color:T.blue2}}/>
            <button onClick={()=>setShow(false)}
              style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:13}}>✕</button>
          </div>
          <div style={{padding:"9px 10px",fontSize:13,color:T.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>
            {text}
          </div>
          {ok && (
            <div style={{display:"flex",gap:6,padding:"7px 10px",borderTop:`1px solid ${T.border}`}}>
              <Btn v="ok" onClick={()=>{onAccept(text);setShow(false);}}>✓ Accetta</Btn>
              <Btn v="ghost" onClick={()=>setShow(false)}>Ignora</Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── ITEM EDITOR ─────────────────────────────────────────────────────────────
const ItemEditor = ({item,onChange,onRemove}) => {
  const calc = cItem(item,item.settings);
  return (
    <div>
      <Card style={{padding:"14px 16px",marginBottom:12}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 100px",gap:10,marginBottom:10}}>
          <div>
            <Lbl c="Nome Item" style={{marginBottom:4}}/>
            <Inp value={item.name} onChange={v=>onChange(p=>({...p,name:v}))}
              placeholder="Nome item…" style={{fontSize:15,fontWeight:600}}/>
          </div>
          <div>
            <Lbl c="Quantità" style={{marginBottom:4}}/>
            <Inp type="number" value={item.qty} min={1}
              onChange={v=>onChange(p=>({...p,qty:Math.max(1,v)}))}/>
          </div>
        </div>
        <AIBox itemName={item.name} description={item.description}
          onAccept={t=>onChange(p=>({...p,description:t}))}/>
        <div style={{position:"relative",marginTop:4}}>
          <Inp value={item.description} rows={3}
            onChange={v=>onChange(p=>({...p,description:v}))}
            placeholder="Caratteristiche: finiture, materiali, tipo aperture, accessori…"/>
          <div style={{position:"absolute",bottom:8,right:8}}>
            <MicBtn onResult={v=>onChange(p=>({...p,description:p.description?p.description+" "+v:v}))}/>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
          <Btn v="danger" onClick={onRemove}>🗑 Elimina</Btn>
        </div>
      </Card>

      {/* Totals */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:8}}>
        {[
          ["Costo",   fmt(calc.cost),       T.text2],
          ["Produz.", fmt(calc.pr.price),   T.blue2],
          ["Materiali",fmt(calc.ma.price),  T.green2],
          ["Prezzo",  fmt(calc.price),      T.text],
        ].map(([l,v,c]) => (
          <Card key={l} style={{padding:"9px 10px"}}>
            <Lbl c={l}/>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",
              fontSize:13,color:c,marginTop:3,fontWeight:500}}>{v}</div>
          </Card>
        ))}
      </div>

      {/* Unit price analysis */}
      {(() => {
        const units = calcItemUnits(item);
        if (units.unit === "pz" && units.total <= 1) return null;
        const pricePerUnit = units.total > 0 ? calc.price / units.total : 0;
        const costPerUnit  = units.total > 0 ? calc.cost  / units.total : 0;
        return (
          <div style={{background:`linear-gradient(135deg,${T.blue}18,${T.green}12)`,
            border:`1px solid ${T.blue}33`,borderRadius:8,padding:"10px 14px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div>
                <Lbl c="Analisi prezzo unitario commerciale" style={{color:T.blue2,marginBottom:2}}/>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:T.text3}}>
                  {units.label}
                </div>
              </div>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{textAlign:"right"}}>
                  <Lbl c={`Costo/${units.unit}`} style={{marginBottom:2}}/>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:15,
                    color:T.text2,fontWeight:600}}>{fmt(costPerUnit)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <Lbl c={`Prezzo/${units.unit}`} style={{color:T.green2,marginBottom:2}}/>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,
                    color:T.green2,fontWeight:700}}>{fmt(pricePerUnit)}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <ProduzioneSection item={item} onChange={onChange}/>
      <MatSection        item={item} onChange={onChange} onUpdateDb={dbItem => {
        // update item.settings.db
        onChange(p => {
          const db = p.settings?.db || [];
          const exists = db.find(d => d.id === dbItem.id);
          const newDb = exists
            ? db.map(d => d.id === dbItem.id ? {...d,...dbItem} : d)
            : [...db, {id:uid(), ...dbItem}];
          return {...p, settings:{...p.settings, db:newDb}};
        });
        // also propagate to project-level settings via a custom event
        if (typeof window !== 'undefined') {
          window._dbUpdate = dbItem;
        }
      }}/>
      <ExtSection        item={item} onChange={onChange}/>
    </div>
  );
};

// ─── SETTINGS VIEW ────────────────────────────────────────────────────────────
const SettingsView = ({settings,onChange,onBack}) => {
  const updFig = (id,k,v) => onChange(s=>({...s,figures:s.figures.map(f=>f.id!==id?f:{...f,[k]:v})}));
  const addFig = () => onChange(s=>({...s,figures:[...s.figures,{id:uid(),name:"Nuova figura",rate:30}]}));
  const remFig = id => onChange(s=>({...s,figures:s.figures.filter(f=>f.id!==id)}));

  const updMac = (id,k,v) => onChange(s=>({...s,machines:s.machines.map(m=>m.id!==id?m:{...m,[k]:v})}));
  const addMac = () => onChange(s=>({...s,machines:[...s.machines,{id:uid(),name:"Nuova macchina",rate:15,defaultFigureId:s.figures[0]?.id}]}));
  const remMac = id => onChange(s=>({...s,machines:s.machines.filter(m=>m.id!==id)}));

  const figOpts = settings.figures.map(f=>({value:f.id,label:f.name}));

  if (michiMode) return (
    <MichiPanel
      project={project}
      settings={globalSettings}
      onChange={onChange}
      onDone={()=>setMichiMode(false)}
      onOpenSettings={()=>{ setMichiMode(false); onOpenSettings&&onOpenSettings(); }}
    />
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:T.bg}}>
      <CSS/>
      <div style={{background:T.surf,borderBottom:`1px solid ${T.border}`,
        padding:"0 14px",height:50,display:"flex",alignItems:"center",
        justifyContent:"space-between",flexShrink:0}}>
        <button onClick={onBack}
          style={{background:"none",border:"none",cursor:"pointer",color:T.text2,
            fontFamily:"'IBM Plex Sans',sans-serif",fontSize:13,
            display:"flex",alignItems:"center",gap:4}}>
          ← Indietro
        </button>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,letterSpacing:1}}>IMPOSTAZIONI</div>
        <div style={{width:80}}/>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"16px 14px"}}>

        {/* Margini globali */}
        <Card style={{padding:14,marginBottom:14}}>
          <Lbl c="Margini Globali di Default" style={{marginBottom:12}}/>
          {[["produzione","Produzione",T.blue2],["materiali","Materiali",T.green2],["esternalizzazioni","Esternalizzazioni",T.yellow2]].map(([cat,label,color]) => (
            <div key={cat} style={{display:"flex",alignItems:"center",
              justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:12,color:T.text2,display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:5,height:5,borderRadius:"50%",
                  background:color,display:"inline-block"}}/>
                {label}
              </span>
              <div style={{display:"flex",alignItems:"center",gap:3,background:T.surf3,
                border:`1px solid ${T.border2}`,borderRadius:4,padding:"3px 8px"}}>
                <input type="number" min={0} value={settings.margins[cat]}
                  onChange={e=>onChange(s=>({...s,margins:{...s.margins,[cat]:parseFloat(e.target.value)||0}}))}
                  style={{background:"none",border:"none",outline:"none",color:T.red2,
                    fontFamily:"'IBM Plex Mono',monospace",fontSize:13,width:44,textAlign:"right"}}/>
                <span style={{color:T.text3,fontFamily:"'IBM Plex Mono',monospace",fontSize:12}}>%</span>
              </div>
            </div>
          ))}
        </Card>

        {/* Figure */}
        <Card style={{padding:14,marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <Lbl c="Figure Professionali"/>
            <Btn v="primary" style={{fontSize:11,padding:"3px 9px"}} onClick={addFig}>+ Aggiungi</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 90px 30px",
            gap:6,paddingBottom:6,borderBottom:`1px solid ${T.border}`,marginBottom:8}}>
            {["Nome","€/ora",""].map((l,i)=><Lbl key={i} c={l}/>)}
          </div>
          {settings.figures.map(f => (
            <div key={f.id} style={{display:"grid",gridTemplateColumns:"1fr 90px 30px",
              gap:6,marginBottom:6,alignItems:"center"}}>
              <Inp value={f.name} onChange={v=>updFig(f.id,"name",v)} placeholder="Nome figura…"/>
              <Inp type="number" value={f.rate} min={0} onChange={v=>updFig(f.id,"rate",v)}/>
              <button onClick={()=>remFig(f.id)}
                style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:13}}>✕</button>
            </div>
          ))}
        </Card>

        {/* Macchine */}
        <Card style={{padding:14,marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <Lbl c="Macchine / Impianti"/>
            <Btn v="primary" style={{fontSize:11,padding:"3px 9px"}} onClick={addMac}>+ Aggiungi</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 75px 1fr 30px",
            gap:6,paddingBottom:6,borderBottom:`1px solid ${T.border}`,marginBottom:8}}>
            {["Macchina","€/ora","Figura default",""].map((l,i)=><Lbl key={i} c={l}/>)}
          </div>
          {settings.machines.map(m => (
            <div key={m.id} style={{display:"grid",gridTemplateColumns:"1fr 75px 1fr 30px",
              gap:6,marginBottom:6,alignItems:"center"}}>
              <Inp value={m.name} onChange={v=>updMac(m.id,"name",v)} placeholder="Nome macchina…"/>
              <Inp type="number" value={m.rate} min={0} onChange={v=>updMac(m.id,"rate",v)}/>
              <Sel value={m.defaultFigureId} options={figOpts}
                onChange={v=>updMac(m.id,"defaultFigureId",v)}/>
              <button onClick={()=>remMac(m.id)}
                style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:13}}>✕</button>
            </div>
          ))}
        </Card>

        {/* DB */}
        <Card style={{padding:14,marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div>
              <Lbl c="Database Materiali"/>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3,marginTop:2}}>
                {settings.db.length} articoli
              </div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
              {settings.db.length > 0 && (
                <Btn v="danger" style={{fontSize:11,padding:"3px 9px"}}
                  onClick={()=>{ onChange(s=>({...s,db:[]})); }}>
                  🗑 Cancella tutto
                </Btn>
              )}
              <Btn v="ghost" style={{fontSize:11,padding:"3px 8px"}}
                onClick={()=>{ onChange(s=>({...s,db:[]})); }}>
                🗑 Svuota DB
              </Btn>
              <label style={{...{borderRadius:5,cursor:"pointer",padding:"5px 11px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4,background:`${T.blue}22`,color:T.blue2,border:`1px solid ${T.blue}`}}}>
                ⬆ Importa CSV
                <input type="file" accept=".csv" style={{display:"none"}} onChange={e=>{
                  const file=e.target.files[0]; if(!file) return;
                  const reader=new FileReader();
                  reader.onload=ev=>{
                    const text = ev.target.result;
                    const lines = text.split(/\r?\n/).filter(l=>l.trim());
                    if (lines.length < 2) return;

                    // Parse CSV respecting quoted fields
                    const parseCSVLine = (line) => {
                      const result = [];
                      let cur = "", inQ = false;
                      for (let i=0; i<line.length; i++) {
                        const ch = line[i];
                        if (ch==='"') { inQ=!inQ; }
                        else if (ch===',' && !inQ) { result.push(cur.trim()); cur=""; }
                        else { cur+=ch; }
                      }
                      result.push(cur.trim());
                      return result;
                    };

                    const header = parseCSVLine(lines[0]).map(h=>h.toLowerCase().trim());
                    const get = (row, ...keys) => {
                      for (const k of keys) {
                        const i = header.indexOf(k);
                        if (i>=0 && row[i]) return row[i].trim();
                      }
                      return "";
                    };
                    const parsePrice = (s) => {
                      // handles "€ 29,93" or "29.93" or "29,93"
                      return parseFloat(
                        s.replace(/[€\s]/g,"").replace(",",".")
                      ) || 0;
                    };

                    const rows = lines.slice(1).map(l => {
                      const vals = parseCSVLine(l);
                      const name = get(vals,"descrizione","name","nome");
                      if (!name) return null;
                      return {
                        id: uid(),
                        name,
                        category:    get(vals,"categoria","category"),
                        subcategory: get(vals,"sottocategoria","subcategory"),
                        brand:       get(vals,"fornitore","brand","marca"),
                        unit:        get(vals,"unità misura","unita misura","unit","unità") || "pz",
                        price:       parsePrice(get(vals,"tot","price","prezzo","costo")),
                        w:           parseFloat(get(vals,"d1","w","larghezza")) || 0,
                        h:           parseFloat(get(vals,"d2","h","altezza"))   || 0,
                        d:           parseFloat(get(vals,"sp","d","spessore"))  || 0,
                        code:        get(vals,"codice","code","cod"),
                        supplierCode:get(vals,"codice fornitore","supplier_code"),
                      };
                    }).filter(Boolean);

                    onChange(s=>({...s, db:[...s.db, ...rows]}));
                    alert(`Importati ${rows.length} articoli nel database.`);
                  };
                  reader.readAsText(file, "UTF-8");
                  e.target.value="";
                }}/>
              </label>
              <Btn v="primary" style={{fontSize:11,padding:"3px 9px"}}
                onClick={()=>onChange(s=>({...s,db:[...s.db,{id:uid(),category:"",subcategory:"",brand:"",name:"",unit:"pz",price:0,w:0,h:0}]}))}>
                + Aggiungi
              </Btn>
            </div>
          </div>

          {/* DB table header */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 80px 70px 55px 55px 60px 24px",
            gap:5,paddingBottom:6,borderBottom:`1px solid ${T.border}`,marginBottom:6}}>
            {["Nome","Categoria","Marca","Unità","€/un.","Dim.(cm)",""].map((l,i)=><Lbl key={i} c={l}/>)}
          </div>
          <div style={{maxHeight:300,overflowY:"auto"}}>
            {settings.db.map(d=>(
              <div key={d.id} style={{display:"grid",
                gridTemplateColumns:"1fr 80px 70px 55px 55px 60px 24px",
                gap:5,marginBottom:5,alignItems:"center"}}>
                <Inp value={d.name||""} onChange={v=>onChange(s=>({...s,db:s.db.map(x=>x.id!==d.id?x:{...x,name:v})}))} placeholder="Nome articolo…"/>
                <Inp value={d.category||""} onChange={v=>onChange(s=>({...s,db:s.db.map(x=>x.id!==d.id?x:{...x,category:v})}))} placeholder="Cat…"/>
                <Inp value={d.brand||""} onChange={v=>onChange(s=>({...s,db:s.db.map(x=>x.id!==d.id?x:{...x,brand:v})}))} placeholder="Marca…"/>
                <select value={d.unit||"pz"} onChange={e=>onChange(s=>({...s,db:s.db.map(x=>x.id!==d.id?x:{...x,unit:e.target.value})}))}
                  style={{width:"100%",background:T.surf3,border:`1px solid ${T.border2}`,borderRadius:5,color:T.text,padding:"5px 4px",outline:"none",fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
                  {UNIT_OPTIONS.map(u=><option key={u.value} value={u.value} style={{background:T.surf2}}>{u.value}</option>)}
                </select>
                <Inp type="number" value={d.price||0} min={0} step={0.01} onChange={v=>onChange(s=>({...s,db:s.db.map(x=>x.id!==d.id?x:{...x,price:v})}))}/>
                <Inp value={d.unit==="mq"?`${d.w||0}×${d.h||0}`:d.unit==="ml"?`${d.w||0}`:"—"} onChange={()=>{}} style={{textAlign:"center",color:T.text3}} placeholder="—"/>
                <button onClick={()=>onChange(s=>({...s,db:s.db.filter(x=>x.id!==d.id)}))}
                  style={{background:"none",border:"none",cursor:"pointer",color:T.text3,fontSize:13}}>✕</button>
              </div>
            ))}
          </div>
          <div style={{marginTop:8,background:`${T.blue}10`,borderRadius:5,padding:"8px 10px",
            border:`1px solid ${T.blue}22`}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.blue2,marginBottom:4}}>
              FORMATO CSV SUPPORTATO
            </div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3,lineHeight:1.7}}>
              Colonne riconosciute automaticamente:<br/>
              <strong style={{color:T.text2}}>descrizione</strong> → nome articolo<br/>
              <strong style={{color:T.text2}}>categoria / sottocategoria</strong><br/>
              <strong style={{color:T.text2}}>unità misura</strong> → pz, mq, ml, mc<br/>
              <strong style={{color:T.text2}}>Tot</strong> → prezzo (formato € 29,93)<br/>
              <strong style={{color:T.text2}}>d1/d2/sp</strong> → larghezza/altezza/spessore (mm)<br/>
              <strong style={{color:T.text2}}>fornitore</strong> → marca/brand<br/>
              <strong style={{color:T.text2}}>codice</strong> → codice articolo
            </div>
          </div>
        </Card>

                <div style={{background:`${T.blue}18`,border:`1px solid ${T.blue}44`,
          borderRadius:8,padding:12,fontSize:12,color:T.text2,lineHeight:1.6}}>
          💡 Le impostazioni salvate qui vengono applicate come <strong>default a tutti i nuovi preventivi</strong>.
          Ogni preventivo può poi sovrascrivere margini e tariffe in modo indipendente.
        </div>
      </div>
    </div>
  );
};

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
const Summary = ({project,onChange}) => {
  const p = cProj(project);
  const s = project.settings;

  const GMR = ({cat,color,label}) => (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
      <span style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:T.text2}}>
        <span style={{width:5,height:5,borderRadius:"50%",background:color,display:"inline-block"}}/>
        {label}
      </span>
      <div style={{display:"flex",alignItems:"center",gap:3,background:T.surf3,
        border:`1px solid ${T.border2}`,borderRadius:4,padding:"3px 7px"}}>
        <input type="number" min={0} value={s.margins[cat]}
          onChange={e=>onChange(proj=>({...proj,settings:{...proj.settings,margins:{...proj.settings.margins,[cat]:parseFloat(e.target.value)||0}}}))}
          style={{background:"none",border:"none",outline:"none",color:T.red2,
            fontFamily:"'IBM Plex Mono',monospace",fontSize:12,width:40,textAlign:"right"}}/>
        <span style={{color:T.text3,fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>%</span>
      </div>
    </div>
  );

  const Row = ({label,val,accent,big}) => (
    <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",
      borderBottom:`1px solid ${T.border}`}}>
      <span style={{fontSize:12,color:big?T.text:T.text2,fontWeight:big?700:400}}>{label}</span>
      <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:big?14:11,
        color:accent||(big?T.text:T.text2),fontWeight:big?700:400}}>{val}</span>
    </div>
  );

  if (!project.items.length) return (
    <div style={{padding:16,color:T.text3,fontSize:12,textAlign:"center",marginTop:20}}>
      Aggiungi item per vedere il riepilogo.
    </div>
  );

  return (
    <div style={{padding:14,overflowY:"auto",height:"100%"}}>
      <Card style={{padding:14,marginBottom:10}}>
        <Lbl c="Totale Preventivo"/>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:26,color:T.green2,lineHeight:1,marginTop:4}}>
          {fmt(p.price)}
        </div>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:T.text3,marginTop:3}}>
          margine medio {p.margin.toFixed(1)}%
        </div>
      </Card>

      <Card style={{padding:14,marginBottom:10}}>
        <Lbl c="Margini del Preventivo" style={{marginBottom:10}}/>
        <GMR cat="produzione"        color={T.blue2}   label="Produzione"/>
        <GMR cat="materiali"         color={T.green2}  label="Materiali"/>
        <GMR cat="esternalizzazioni" color={T.yellow2} label="Esternalizzazioni"/>
      </Card>

      <Card style={{padding:14,marginBottom:10}}>
        <Row label="Produzione"        val={fmt(p.prP)}/>
        <Row label="Materiali"         val={fmt(p.maP)}/>
        <Row label="Esternalizzazioni" val={fmt(p.exP)}/>
        <Row label="Costo totale"      val={fmt(p.cost)} big/>
        <Row label="Margine lordo"     val={fmt(p.price-p.cost)} accent={T.red2}/>
        <div style={{display:"flex",justifyContent:"space-between",paddingTop:8}}>
          <span style={{fontSize:13,fontWeight:700}}>PREZZO TOTALE</span>
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,
            color:T.green2,fontWeight:700}}>{fmt(p.price)}</span>
        </div>
      </Card>

      <Card style={{padding:14}}>
        <Lbl c="Per Item" style={{marginBottom:8}}/>
        {project.items.map(it => {
          const c = cItem(it,project.settings);
          return (
            <div key={it.id} style={{display:"flex",justifyContent:"space-between",
              padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>
              <span style={{fontSize:12,color:T.text2,overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140}}>
                {it.name||"—"}
              </span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:T.green2}}>
                {fmt(c.price)}
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );
};


// ─── MICHI AGENT ─────────────────────────────────────────────────────────────

const MICHI_SYSTEM = `Sei Michi, un mastro falegname con decenni di esperienza nell'arredo su misura italiano.
Sei l'assistente AI dell'app di preventivazione per falegnamerie.
Parli in italiano, con tono professionale ma caldo e diretto — come un collega esperto che guida con rispetto.
Non usi mai emoji. Sei conciso (max 3 frasi per risposta normale, più lungo solo se necessario).
Hai accesso al contesto del preventivo in corso e puoi suggerire, correggere e migliorare.

CAPACITÀ:
- Guidi la creazione del preventivo step by step
- Stimi materiali e ore di produzione da descrizioni e foto
- Suggerisci materiali dal database
- Avverti se i margini sono bassi o le ore stimate sembrano insufficienti
- Ricordi tutto quello che è stato detto nella sessione
- Proponi correzioni proattive basandoti sull'esperienza di falegnameria

REGOLE:
- Se ti chiedono una stima, genera SEMPRE un JSON strutturato con phases, materials, externalizations
- Se noti qualcosa di anomalo (ore troppo poche, materiali mancanti, margini bassi) dillo chiaramente
- Usa i dati del preventivo in corso come contesto per le tue risposte
- Impara dai preventivi storici forniti`;

const MICHI_AVATAR = ({speaking=false, size=80}) => {
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);
  const [armSwing, setArmSwing] = useState(false);
  useEffect(()=>{
    const t = setInterval(()=>{ setBlink(true); setTimeout(()=>setBlink(false),140); }, 3200+Math.random()*2000);
    return ()=>clearInterval(t);
  },[]);
  useEffect(()=>{
    if(!speaking){setMouthOpen(false);setArmSwing(false);return;}
    let v=true; const t1=setInterval(()=>{setMouthOpen(v);v=!v;},200);
    let a=false; const t2=setInterval(()=>{setArmSwing(a);a=!a;},600);
    return ()=>{clearInterval(t1);clearInterval(t2);};
  },[speaking]);
  const W=size*0.5, H=size;
  return (
    <div style={{width:W,height:H,flexShrink:0,filter:speaking?`drop-shadow(0 0 8px ${T.blue2}99)`:"none",transition:"filter .4s"}}>
      <svg width={W} height={H} viewBox="0 0 80 160" fill="none">
        {speaking&&<ellipse cx="40" cy="30" rx="26" ry="26" stroke={T.blue2} strokeWidth="1.2" strokeDasharray="5 3" opacity="0.5"><animateTransform attributeName="transform" type="rotate" from="0 40 30" to="360 40 30" dur="3s" repeatCount="indefinite"/></ellipse>}
        {/* Legs */}
        <rect x="26" y="112" width="11" height="32" rx="4" fill="#4A3728"/>
        <rect x="43" y="112" width="11" height="32" rx="4" fill="#4A3728"/>
        <ellipse cx="31" cy="144" rx="8" ry="4" fill="#1A1A1A"/>
        <ellipse cx="49" cy="144" rx="8" ry="4" fill="#1A1A1A"/>
        {/* Body + apron */}
        <rect x="22" y="72" width="36" height="44" rx="6" fill="#7B9CB5"/>
        <path d="M28 76 L52 76 L55 118 L25 118 Z" fill="#8B6914"/>
        <path d="M30 78 L50 78 L53 116 L27 116 Z" fill="#A0791A"/>
        <path d="M34 76 L36 58 L40 56 L44 58 L46 76" fill="none" stroke="#8B6914" strokeWidth="4" strokeLinecap="round"/>
        <rect x="33" y="92" width="14" height="10" rx="2" fill="#7A5F10"/>
        <rect x="39" y="88" width="2" height="8" rx="0.5" fill="#F5D76E"/>
        <polygon points="39,88 41,88 40,86" fill="#E8804A"/>
        {/* Arms */}
        <g transform={armSwing?"rotate(8,24,82)":"rotate(0,24,82)"} style={{transition:"transform .2s"}}>
          <path d="M24 82 Q16 98 14 110" stroke="#7B9CB5" strokeWidth="9" strokeLinecap="round"/>
          <ellipse cx="13" cy="112" rx="5" ry="4" fill="#D4956A"/>
          <rect x="7" y="110" width="2" height="14" rx="1" fill="#6B4A2A"/>
          <rect x="4" y="108" width="8" height="5" rx="1.5" fill="#888"/>
        </g>
        <g transform={armSwing?"rotate(-5,56,82)":"rotate(0,56,82)"} style={{transition:"transform .2s"}}>
          <path d="M56 82 Q64 98 66 110" stroke="#7B9CB5" strokeWidth="9" strokeLinecap="round"/>
          <ellipse cx="67" cy="112" rx="5" ry="4" fill="#D4956A"/>
        </g>
        {/* Neck + Head */}
        <rect x="34" y="56" width="12" height="18" rx="4" fill="#D4956A"/>
        <ellipse cx="40" cy="34" rx="22" ry="24" fill="#D4956A"/>
        {/* Hair */}
        <path d="M18 28 Q16 20 20 14 Q22 10 26 12 Q20 18 20 28 Z" fill="#B0B8C0"/>
        <path d="M62 28 Q64 20 60 14 Q58 10 54 12 Q60 18 60 28 Z" fill="#B0B8C0"/>
        <ellipse cx="40" cy="15" rx="12" ry="6" fill="#C8CCCE" opacity="0.25"/>
        <rect x="18" y="32" width="4" height="12" rx="2" fill="#A8B0B8"/>
        <rect x="58" y="32" width="4" height="12" rx="2" fill="#A8B0B8"/>
        {/* Eyebrows */}
        <path d="M22 26 Q28 22 34 25" stroke="#5A4030" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        <path d="M46 25 Q52 22 58 26" stroke="#5A4030" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        {/* Eyes */}
        <ellipse cx="28" cy="31" rx="4.5" ry={blink?0.5:4} fill="white"/>
        <ellipse cx="52" cy="31" rx="4.5" ry={blink?0.5:4} fill="white"/>
        {!blink&&<><ellipse cx="28" cy="31.5" rx="3" ry="3" fill="#3D2510"/><ellipse cx="52" cy="31.5" rx="3" ry="3" fill="#3D2510"/><circle cx="28" cy="32" r="1.5" fill="#1A0E08"/><circle cx="52" cy="32" r="1.5" fill="#1A0E08"/><circle cx="29.2" cy="30.2" r="1" fill="white" opacity="0.9"/><circle cx="53.2" cy="30.2" r="1" fill="white" opacity="0.9"/></>}
        {/* Nose */}
        <circle cx="35.5" cy="42" r="2.5" fill="#C8855A" opacity="0.5"/>
        <circle cx="44.5" cy="42" r="2.5" fill="#C8855A" opacity="0.5"/>
        <path d="M36 42 Q38 44 40 43 Q42 44 44 42" stroke="#B07848" strokeWidth="1" fill="none"/>
        {/* Mouth */}
        {mouthOpen
          ?<><path d="M31 50 Q40 55 49 50" fill="#5A2A1A"/><path d="M34 50 Q40 52 46 50 Q40 48 34 50 Z" fill="#F0EDE8" opacity="0.9"/></>
          :<path d="M31 50 Q36 54 40 53 Q44 54 49 50" stroke="#8B5535" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
        }
        {/* Ears */}
        <ellipse cx="18" cy="33" rx="4" ry="5.5" fill="#C8855A"/>
        <ellipse cx="62" cy="33" rx="4" ry="5.5" fill="#C8855A"/>
        {/* Sawdust */}
        {speaking&&<><circle cx="15" cy="95" r="1.5" fill="#C8A050" opacity="0.7"><animate attributeName="cy" from="95" to="120" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.7" to="0" dur="1.5s" repeatCount="indefinite"/></circle><circle cx="65" cy="88" r="1" fill="#C8A050" opacity="0.6"><animate attributeName="cy" from="88" to="115" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite"/></circle></>}
      </svg>
    </div>
  );
};

const MICHI_BUBBLE = ({text, children, typing=false, speaking=false}) => (
  <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:16}}>
    <MICHI_AVATAR speaking={typing||speaking} size={80}/>
    <div style={{flex:1}}>
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,
        color:T.blue2,letterSpacing:1,marginBottom:5,display:"flex",alignItems:"center",gap:6}}>
        MICHI
        {typing && (
          <span style={{display:"inline-flex",gap:3,alignItems:"center"}}>
            {[0,1,2].map(i=>(
              <span key={i} style={{width:4,height:4,borderRadius:"50%",background:T.blue2,
                animation:`michi-dot 1.2s ${i*0.2}s ease-in-out infinite`,display:"inline-block"}}/>
            ))}
          </span>
        )}
      </div>
      <div style={{background:T.surf2,border:`1px solid ${T.blue}44`,
        borderRadius:"0 10px 10px 10px",padding:"10px 14px",
        fontSize:13,color:T.text,lineHeight:1.6}}>
        {typing
          ? <span style={{color:T.text3,fontStyle:"italic"}}>Michi sta scrivendo…</span>
          : text || children
        }
      </div>
      {!typing && (text||children) && (
        <div style={{marginTop:5}}>
          <SpeakBtn text={typeof text==="string"?text:(typeof children==="string"?children:"")}/>
        </div>
      )}
    </div>
  </div>
);

const USER_BUBBLE = ({text}) => (
  <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
    <div style={{background:T.surf3,border:`1px solid ${T.border}`,
      borderRadius:"10px 0 10px 10px",padding:"8px 12px",
      fontSize:13,color:T.text,lineHeight:1.5,maxWidth:"75%"}}>
      {text}
    </div>
  </div>
);

const MICHI_CHOICES = ({options, onSelect}) => (
  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14,paddingLeft:50}}>
    {options.map((opt,i) => (
      <button key={i} onClick={()=>onSelect(opt.value||opt.label, opt.label)}
        style={{background:`${T.blue}18`,border:`1px solid ${T.blue}44`,
          borderRadius:20,padding:"6px 14px",cursor:"pointer",
          color:T.blue2,fontFamily:"'IBM Plex Sans',sans-serif",
          fontSize:12,fontWeight:600,transition:"all .15s"}}
        onMouseEnter={e=>{e.target.style.background=`${T.blue}35`;e.target.style.borderColor=T.blue2;}}
        onMouseLeave={e=>{e.target.style.background=`${T.blue}18`;e.target.style.borderColor=`${T.blue}44`;}}>
        {opt.label}
      </button>
    ))}
  </div>
);

// ─── MICHI AGENT PANEL ────────────────────────────────────────────────────────
const MichiPanel = ({project, settings, onChange, onDone, onOpenSettings}) => {
  const [messages, setMessages]       = useState([]); // {role, content, choices?, form?}
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [speaking, setSpeaking]       = useState(false);
  const [phase, setPhase]             = useState("intro");
  const [currentItemId, setCurrentItemId] = useState(null);
  const [itemSection, setItemSection] = useState("produzione");
  const [showClientForm, setShowClientForm] = useState(false);
  const [showItemForm, setShowItemForm]     = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(()=>{
    if(endRef.current) endRef.current.scrollIntoView({behavior:"smooth"});
  },[messages, loading]);

  // Build context string for the agent
  const buildContext = () => {
    const proj = project;
    const totals = proj.items.map(it=>{
      const c = cItem(it, proj.settings);
      return "  - " + it.name + " qta:" + it.qty + " prezzo:" + Math.round(c.price) + " costo:" + Math.round(c.cost);
    }).join("\n");
    const figList = proj.settings.figures.map(f=> f.name + "(" + f.rate + " eur/h)").join(", ");
    const macList = proj.settings.machines.map(m=> m.name + "(+" + m.rate + " eur/h)").join(", ");
    const L = [
      "PREVENTIVO IN CORSO:",
      "- Nome: " + (proj.name||"Non definito"),
      "- Cliente: " + (proj.client||"Non definito"),
      "- Riferimento: " + (proj.ref||"Non definito"),
      "- Items (" + proj.items.length + "):",
      totals || "  (nessun item ancora)",
      "- Margini: produzione " + proj.settings.margins.produzione + "%, materiali " + proj.settings.margins.materiali + "%, esternalizzazioni " + proj.settings.margins.esternalizzazioni + "%",
      "- Figure: " + figList,
      "- Macchine: " + macList
    ];
    return L.join("\n");
  };

  // Send message to agent
  const sendToAgent = async (userMsg, systemExtra="") => {
    setLoading(true);
    // Build conversation history for API
    const history = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({role: m.role, content: m.content}));

    // Add current user message
    const allMessages = [
      ...history,
      {role:"user", content: userMsg}
    ];

    try {
      const d = await callMichi({
        max_tokens:1000,
        system: MICHI_SYSTEM + "\n\n" + buildContext() + (systemExtra ? "\n\n" + systemExtra : ""),
        messages: allMessages
      });
      const text = d.content?.find(b=>b.type==="text")?.text?.trim()||"";

      // Check if response contains a JSON estimate
      let estimate = null;
      if (text.includes('"phases"') || text.includes('"materials"')) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) estimate = JSON.parse(jsonMatch[0]);
        } catch(e) {}
      }

      // Brief speaking animation
      setSpeaking(true);
      setTimeout(()=>setSpeaking(false), Math.min(text.length*40, 4000));

      return { text, estimate };
    } catch(e) {
      return { text: "Aspetta un attimo, mi si è inceppata la sega. Riprova a scrivermi tra poco.", estimate: null };
    } finally {
      setLoading(false);
    }
  };

  const addMessage = (role, content, extra={}) => {
    setMessages(prev => [...prev, {role, content, ...extra}]);
    // Voce automatica per i messaggi di Michi
    if (role === "assistant" && content) {
      try { speakOrus(content, ()=>setSpeaking(true), ()=>setSpeaking(false)); } catch(e){}
    }
  };

  // Initialize agent with a contextual, varied greeting (no API call needed)
  useEffect(()=>{
    addMessage("assistant",
      agentGreeting(project),
      {
        choices:[
          {label:"Inserisci cliente e progetto"},
          {label:"Aggiungi subito un item"},
          {label:"Vedi impostazioni"},
        ]
      });
  }, []);

  const handleSend = async (text) => {
    if (!text.trim() || loading) return;
    const userText = text.trim();
    setInput("");
    addMessage("user", userText);

    // Check for special commands
    const lower = userText.toLowerCase();
    if (lower.includes("impostazion")) { onOpenSettings(); return; }
    if (lower.includes("editor") || lower.includes("completo")) { onDone(); return; }

    const {text: reply, estimate} = await sendToAgent(userText);

    // If there's an estimate, offer to apply it
    if (estimate) {
      addMessage("assistant", reply, {
        estimate,
        choices:[
          {label:"✓ Applica questa stima", value:"__apply_estimate__"},
          {label:"Modifica prima"},
          {label:"Aggiungi item senza stima"},
        ]
      });
    } else {
      // Generate contextual choices based on phase
      const choices = [];
      if (phase === "intro") {
        if (project.client) choices.push({label:"Procedi con gli item"});
        else choices.push({label:"Inserisci cliente"});
      } else if (phase === "chat") {
        choices.push({label:"Aggiungi nuovo item"});
        choices.push({label:"Vedi riepilogo"});
        choices.push({label:"Genera stima AI"});
      }
      addMessage("assistant", reply, {choices: choices.length ? choices : undefined});
    }
  };

  const handleChoice = async (value, label) => {
    // ── Structural actions: open forms, no AI call ──
    const lc = (label||"").toLowerCase();
    if (lc.includes("inserisci cliente") || lc.includes("cliente e progetto")) {
      setShowClientForm(true);
      addMessage("user", label);
      addMessage("assistant", "Perfetto, compila i dati qui sotto.", {showClientForm:true});
      return;
    }
    if (lc.includes("aggiungi") && lc.includes("item")) {
      setShowItemForm(true);
      addMessage("user", label);
      addMessage("assistant", "Ottimo, aggiungiamo un nuovo elemento. Compila qui sotto, e se vuoi posso generarti una stima automatica.", {showItemForm:true});
      return;
    }
    if (lc.includes("impostazion")) { onOpenSettings(); return; }
    if (lc.includes("editor") || lc.includes("completo")) { onDone(); return; }
    if (lc.includes("riepilogo")) {
      addMessage("user", label);
      addMessage("assistant", "Ecco il riepilogo del preventivo.", {showSummary:true});
      return;
    }
    if (value === "__analyze__" || (lc.includes("analizza") && lc.includes("item"))) {
      addMessage("user", label);
      addMessage("assistant", "Eccolo. Lavora su produzione, materiali ed esternalizzazioni qui sotto.", {showItemEditor:true});
      return;
    }

    if (value === "__apply_estimate__") {
      // Find the last estimate in messages
      const lastEstimate = [...messages].reverse().find(m=>m.estimate)?.estimate;
      if (lastEstimate) {
        const it = mkItem(project.settings);
        it.name = lastEstimate.name || "Nuovo Item";
        it.description = lastEstimate.description || "";
        if (lastEstimate.phases?.length) {
          it.produzione.phases = lastEstimate.phases.map(ph=>({
            id:uid(), name:ph.name,
            subphases:(ph.subphases||[]).map(sp=>({
              id:uid(), name:sp.name,
              figureId:sp.figureId||project.settings.figures[0]?.id,
              machineId:sp.machineId||null, hours:sp.hours||0
            }))
          }));
        }
        if (lastEstimate.materials?.length) {
          it.materiali.rows = lastEstimate.materials.map(m=>({
            id:uid(),name:m.name||"",brand:"",category:"",subcategory:"",
            price:m.price||0,unit:m.unit||"pz",qty:m.qty||1,w:0,h:0,d:0,dbId:null
          }));
        }
        if (lastEstimate.externalizations?.length) {
          it.esternalizzazioni.rows = lastEstimate.externalizations.map(e=>({
            id:uid(),name:e.name||"",price:e.price||0,unit:e.unit||"pz",qty:e.qty||1
          }));
        }
        onChange(p=>({...p, items:[...p.items, it]}));
        setCurrentItemId(it.id);
        setPhase("chat");
      }
      addMessage("user", label);
      const {text: reply} = await sendToAgent("Ho applicato la stima. Cosa devo fare ora?");
      addMessage("assistant", reply, {choices:[
        {label:"Aggiungi altro item"},
        {label:"Modifica item"},
        {label:"Vai al riepilogo"},
      ]});
      return;
    }

    // handleSend already adds the user message, so don't double-add
    await handleSend(label);
  };

  const currentItem = project.items.find(i=>i.id===currentItemId);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:T.bg}}>
      {/* Header — Michi protagonista */}
      <div style={{background:`linear-gradient(180deg,${T.surf},${T.bg})`,
        borderBottom:`1px solid ${T.border}`,
        padding:"10px 14px 6px",display:"flex",alignItems:"center",
        justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <MICHI_AVATAR size={96} speaking={speaking||loading}/>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,letterSpacing:0.5,fontWeight:800,color:T.text}}>Michi</div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.blue2,letterSpacing:1}}>
              IL TUO MASTRO PREVENTIVISTA
            </div>
            {(loading||speaking) && (
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3,marginTop:2,
                display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:5,height:5,borderRadius:"50%",background:T.green2,
                  animation:"michi-dot 1s infinite"}}/>
                {loading ? "sta pensando…" : "sta parlando…"}
              </div>
            )}
          </div>
        </div>
        <Btn v="ghost" style={{fontSize:11}} onClick={onDone}>Editor →</Btn>
      </div>

      {/* Chat messages */}
      <div style={{flex:1,overflowY:"auto",padding:"14px 14px 0"}}>
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role==="assistant" && <MICHI_BUBBLE text={msg.content} speaking={speaking&&i===messages.length-1}/>}
            {msg.role==="user"      && <USER_BUBBLE text={msg.content}/>}
            {msg.choices && msg.role==="assistant" && (
              <MICHI_CHOICES options={msg.choices} onSelect={handleChoice}/>
            )}
            {/* Show item sections if we have a current item */}
            {msg.showItemEditor && currentItem && (
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",gap:6,marginBottom:8,paddingLeft:50}}>
                  {["produzione","materiali","esternalizzazioni"].map(s=>(
                    <button key={s} onClick={()=>setItemSection(s)}
                      style={{padding:"4px 10px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,
                        background:itemSection===s?T.blue:"transparent",
                        color:itemSection===s?"#fff":T.text3,
                        border:`1px solid ${itemSection===s?T.blue:T.border2}`}}>
                      {s==="produzione"?"🔵":s==="materiali"?"🟢":"🟡"} {s}
                    </button>
                  ))}
                </div>
                {itemSection==="produzione" && (
                  <ProduzioneSection item={currentItem}
                    onChange={upd=>onChange(p=>({...p,items:p.items.map(it=>it.id!==currentItem.id?it:upd(it))}))}/>
                )}
                {itemSection==="materiali" && (
                  <MatSection item={currentItem}
                    onChange={upd=>onChange(p=>({...p,items:p.items.map(it=>it.id!==currentItem.id?it:upd(it))}))}
                    onUpdateDb={dbItem=>{
                      onChange(p=>{
                        const db=p.settings?.db||[];
                        const exists=db.find(d=>d.id===dbItem.id);
                        const newDb=exists?db.map(d=>d.id===dbItem.id?{...d,...dbItem}:d):[...db,{id:uid(),...dbItem}];
                        return{...p,settings:{...p.settings,db:newDb}};
                      });
                    }}/>
                )}
                {itemSection==="esternalizzazioni" && (
                  <ExtSection item={currentItem}
                    onChange={upd=>onChange(p=>({...p,items:p.items.map(it=>it.id!==currentItem.id?it:upd(it))}))}/>
                )}
              </div>
            )}

            {/* CLIENT FORM */}
            {msg.showClientForm && (
              <div style={{marginBottom:14,paddingLeft:50}}>
                <div style={{background:T.surf2,border:`1px solid ${T.blue}44`,
                  borderRadius:8,padding:14}}>
                  <div style={{marginBottom:8}}>
                    <Lbl c="Nome preventivo" style={{marginBottom:3}}/>
                    <Inp value={project.name||""} onChange={v=>onChange(p=>({...p,name:v}))}
                      placeholder="es. Banco bar Hotel Roma…"/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <div>
                      <Lbl c="Cliente" style={{marginBottom:3}}/>
                      <Inp value={project.client||""} onChange={v=>onChange(p=>({...p,client:v}))}
                        placeholder="Azienda o privato…"/>
                    </div>
                    <div>
                      <Lbl c="Cantiere / Rif." style={{marginBottom:3}}/>
                      <Inp value={project.ref||""} onChange={v=>onChange(p=>({...p,ref:v}))}
                        placeholder="es. Villa Rossi…"/>
                    </div>
                  </div>
                  <Btn v="primary" style={{width:"100%",justifyContent:"center"}}
                    onClick={()=>{
                      setShowClientForm(false);
                      setPhase("chat");
                      addMessage("assistant",
                        "Bene" + (project.client?", lavoriamo per "+project.client:"") + ". Ora aggiungiamo gli elementi da preventivare.",
                        {choices:[{label:"Aggiungi un item"},{label:"Vai all'editor completo"}]});
                    }}>
                    ✓ Salva e continua
                  </Btn>
                </div>
              </div>
            )}

            {/* ITEM FORM */}
            {msg.showItemForm && (
              <div style={{marginBottom:14,paddingLeft:50}}>
                <NewItemForm
                  settings={project.settings}
                  projectHistory={[project]}
                  onAdd={(it)=>{
                    onChange(p=>({...p, items:[...p.items, it]}));
                    setCurrentItemId(it.id);
                    setShowItemForm(false);
                    setPhase("chat");
                    addMessage("assistant",
                      'Aggiunto "' + it.name + '". Vuoi analizzarlo nel dettaglio o aggiungere altro?',
                      {choices:[
                        {label:"Analizza questo item", value:"__analyze__"},
                        {label:"Aggiungi un altro item"},
                        {label:"Vai al riepilogo"},
                      ]});
                  }}/>
              </div>
            )}

            {/* SUMMARY */}
            {msg.showSummary && (
              <div style={{marginBottom:14,paddingLeft:50}}>
                <Summary project={project} onChange={onChange}/>
              </div>
            )}
          </div>
        ))}
        {loading && <MICHI_BUBBLE typing/>}
        <div ref={endRef}/>
      </div>

      {/* Input area */}
      <div style={{padding:"10px 14px",background:T.surf,
        borderTop:`1px solid ${T.border}`,flexShrink:0}}>
        {/* Quick actions */}
        <div style={{display:"flex",gap:5,marginBottom:8,overflowX:"auto",paddingBottom:2}}>
          {[
            {label:"+ Item",      action:"Voglio aggiungere un nuovo item al preventivo"},
            {label:"📊 Riepilogo", action:"Mostrami il riepilogo del preventivo con i totali"},
            {label:"✦ Stima AI",  action:"Genera una stima AI per il prossimo item"},
            {label:"⚙ Settings",  action:"impostazioni"},
          ].map((q,i)=>(
            <button key={i} onClick={()=>handleSend(q.action)}
              disabled={loading}
              style={{flexShrink:0,padding:"4px 10px",borderRadius:12,cursor:"pointer",
                background:T.surf2,border:`1px solid ${T.border2}`,
                color:T.text2,fontSize:11,fontWeight:600,
                fontFamily:"'IBM Plex Sans',sans-serif",
                opacity:loading?0.5:1}}>
              {q.label}
            </button>
          ))}
        </div>

        {/* Text input + mic */}
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <div style={{flex:1,position:"relative"}}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{
                if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend(input);}
              }}
              placeholder="Scrivi a Michi… (Invio per inviare)"
              rows={1}
              disabled={loading}
              style={{width:"100%",background:T.surf3,border:`1px solid ${T.border2}`,
                borderRadius:8,color:T.text,padding:"8px 12px",outline:"none",
                fontFamily:"'IBM Plex Sans',sans-serif",fontSize:13,
                resize:"none",lineHeight:1.4,
                opacity:loading?0.6:1}}
              onFocus={e=>e.target.style.borderColor=T.blue2}
              onBlur={e=>e.target.style.borderColor=T.border2}
            />
          </div>
          <MicBtn onResult={v=>{setInput(v);}} style={{marginBottom:2}}/>
          <button onClick={()=>handleSend(input)} disabled={loading||!input.trim()}
            style={{background:T.blue,border:"none",borderRadius:8,
              cursor:"pointer",padding:"8px 14px",color:"#fff",
              fontSize:13,fontWeight:700,flexShrink:0,
              opacity:loading||!input.trim()?0.4:1,
              fontFamily:"'IBM Plex Sans',sans-serif",
              marginBottom:2}}>
            →
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── NEW ITEM FORM (used inside Michi) ───────────────────────────────────────
const NewItemForm = ({settings, onAdd, projectHistory=[]}) => {
  const [name, setName]               = useState("");
  const [desc, setDesc]               = useState("");
  const [dims, setDims]               = useState("");
  const [qty,  setQty]                = useState(1);
  const [loading, setLoading]         = useState(false);
  const [preview, setPreview]         = useState(null);
  const [imgFile, setImgFile]         = useState(null);
  const [imgB64,  setImgB64]          = useState(null);
  const [fileType, setFileType]       = useState(null); // "image" | "pdf"
  const [fileMime, setFileMime]       = useState("image/jpeg");
  const [analysisUnit, setAnalysisUnit] = useState("pz");
  const [unitW, setUnitW]             = useState(0);
  const [unitH, setUnitH]             = useState(0);
  const [unitL, setUnitL]             = useState(0);
  const [piecesAllEqual, setPiecesAllEqual] = useState(true);
  const [pieces, setPieces]           = useState([]);

  const handleImg = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImgFile(file.name);
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    setFileType(isPdf ? "pdf" : "image");
    setFileMime(isPdf ? "application/pdf" : (file.type || "image/jpeg"));
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target.result.split(",")[1];
      setImgB64(b64);
      // Suggerimento automatico: Michi legge il file e propone nome/descrizione
      suggestFromFile(b64, isPdf ? "pdf" : "image", isPdf ? "application/pdf" : (file.type||"image/jpeg"));
    };
    reader.readAsDataURL(file);
  };

  const [suggesting, setSuggesting] = useState(false);
  const suggestFromFile = async (b64, type, mime) => {
    setSuggesting(true);
    const ask = "Guarda questo " + (type==="pdf"?"disegno tecnico/documento PDF":"immagine") + " di un arredo su misura. Proponi un nome breve per l'elemento e una descrizione tecnica di 1-2 frasi. Rispondi SOLO con JSON: {\"name\":\"...\",\"description\":\"...\",\"caratteristiche\":\"...\"}";
    try {
      const content = type==="pdf"
        ? [{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},{type:"text",text:ask}]
        : [{type:"image",source:{type:"base64",media_type:mime,data:b64}},{type:"text",text:ask}];
      const d = await callMichi({max_tokens:600, messages:[{role:"user",content}]});
      const raw = d.content?.find(b=>b.type==="text")?.text?.trim()||"";
      const sug = JSON.parse(stripFences(raw));
      if (sug.name && !name.trim()) setName(sug.name);
      if (sug.description && !desc.trim()) setDesc(sug.description);
      if (sug.caratteristiche && !dims.trim()) setDims(sug.caratteristiche);
    } catch(e) { /* suggerimento non riuscito, l'utente compila a mano */ }
    finally { setSuggesting(false); }
  };

  const buildHistoryContext = () => {
    if (!projectHistory.length) return "";
    const samples = projectHistory.slice(-4).flatMap(proj =>
      proj.items.slice(0,2).map(it => {
        const totH = it.produzione.phases.reduce((s,ph)=>s+ph.subphases.reduce((ss,sp)=>ss+(sp.hours||0),0),0);
        return "- " + it.name + " qta " + it.qty + ": " + Math.round(totH) + "h produzione";
      })
    ).join("\n");
    return samples ? `\n\nSTORICO TUOI PREVENTIVI (usa per calibrare):\n${samples}` : "";
  };

  const generateEstimate = async () => {
    if (!name.trim() && !desc.trim()) return;
    setLoading(true); setPreview(null);
    const figList = settings.figures.map(f=> f.id + "=" + f.name + "(" + f.rate + " eur/h)").join(", ");
    const macList = settings.machines.map(m=> m.id + "=" + m.name + "(+" + m.rate + " eur/h)").join(", ");
    const dbSample = (settings.db||[]).slice(0,30).map(d=> d.name + "(" + d.unit + "," + d.price + ")").join(", ");
    const prompt = `Sei un esperto preventivista di falegnameria italiana con 40 anni di esperienza.
Stima materiali e tempi per questo arredo.

ELEMENTO: ${name||"n/d"} | DESCRIZIONE: ${desc||"n/d"} | CARATTERISTICHE: ${dims||"n/d"} | QTÀ: ${qty}
FIGURE: ${figList}
MACCHINE: ${macList}
DB MATERIALI (campione): ${dbSample}
${buildHistoryContext()}

Rispondi SOLO con JSON valido, nessun testo fuori:
{"description":"descrizione tecnica 2-3 frasi","phases":[{"name":"nome fase","subphases":[{"name":"sottofase","figureId":"f1-f5","machineId":"m1-m6 o null","hours":0.0}]}],"materials":[{"name":"nome","unit":"mq/ml/pz/mc/ps","qty":0.0,"price":0.0}],"externalizations":[{"name":"attività","unit":"pz","qty":1,"price":0.0}],"notes":"assunzioni e note"}`;

    try {
      let messages;
      if (imgB64 && fileType === "pdf") {
        // PDF inviato come documento
        messages = [{role:"user",content:[
          {type:"document",source:{type:"base64",media_type:"application/pdf",data:imgB64}},
          {type:"text",text:prompt + "\n\nAnalizza il disegno/documento PDF allegato per ricavare misure, materiali e lavorazioni."}
        ]}];
      } else if (imgB64 && fileType === "image") {
        // Immagine (foto o render)
        messages = [{role:"user",content:[
          {type:"image",source:{type:"base64",media_type:fileMime,data:imgB64}},
          {type:"text",text:prompt + "\n\nAnalizza l'immagine allegata (foto o render) per ricavare materiali e lavorazioni."}
        ]}];
      } else {
        messages = [{role:"user",content:prompt}];
      }
      const d = await callMichi({max_tokens:2500, messages});
      const raw = d.content?.find(b=>b.type==="text")?.text?.trim()||"";
      setPreview(JSON.parse(stripFences(raw)));
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  const applyEstimate = () => {
    if (!preview) return;
    const it = mkItem(settings);
    it.name = name||"Item"; it.description = preview.description||desc; it.qty = qty;
    if (preview.phases?.length) {
      it.produzione.phases = preview.phases.map(ph=>({
        id:uid(), name:ph.name,
        subphases:(ph.subphases||[]).map(sp=>({
          id:uid(), name:sp.name,
          figureId:sp.figureId||settings.figures[0]?.id,
          machineId:sp.machineId||null, hours:sp.hours||0
        }))
      }));
    }
    if (preview.materials?.length) {
      it.materiali.rows = preview.materials.map(m=>({
        id:uid(),name:m.name||"",brand:"",category:"",subcategory:"",
        price:m.price||0,unit:m.unit||"pz",qty:m.qty||1,w:0,h:0,d:0,dbId:null
      }));
    }
    if (preview.externalizations?.length) {
      it.esternalizzazioni.rows = preview.externalizations.map(e=>({
        id:uid(),name:e.name||"",price:e.price||0,unit:e.unit||"pz",qty:e.qty||1
      }));
    }
    // Apply analysis unit data
    it.analysisUnit = analysisUnit;
    it.piecesAllEqual = piecesAllEqual;
    it.pieces = pieces;
    it.unitW = unitW; it.unitH = unitH; it.unitL = unitL;
    onAdd(it);
    setName("");setDesc("");setDims("");setQty(1);
    setPreview(null);setImgFile(null);setImgB64(null);
    setAnalysisUnit("pz");setUnitW(0);setUnitH(0);setUnitL(0);
    setPiecesAllEqual(true);setPieces([]);
  };

  const totH = preview ? preview.phases?.reduce((s,ph)=>s+(ph.subphases?.reduce((ss,sp)=>ss+(sp.hours||0),0)||0),0)||0 : 0;
  const totMat = preview ? preview.materials?.reduce((s,m)=>s+(m.qty||0)*(m.price||0),0)||0 : 0;
  const totExt = preview ? preview.externalizations?.reduce((s,e)=>s+(e.qty||0)*(e.price||0),0)||0 : 0;

  return (
    <div style={{background:T.surf3,borderRadius:8,padding:"12px",border:`1px solid ${T.border}`,marginBottom:8}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 70px",gap:8,marginBottom:8}}>
        <div><Lbl c="Nome item" style={{marginBottom:3}}/><Inp value={name} onChange={setName} placeholder="es. Armadio, Cucina, Porta…"/></div>
        <div><Lbl c="Qtà" style={{marginBottom:3}}/><Inp type="number" value={qty} min={1} onChange={v=>setQty(Math.max(1,v))}/></div>
      </div>
      <div style={{marginBottom:8}}>
        <Lbl c="Descrizione" style={{marginBottom:3}}/>
        <Inp value={desc} onChange={setDesc} rows={2} placeholder="es. Mobile TV sospeso per suite, struttura in nobilitato…"/>
      </div>
      <div style={{marginBottom:8}}>
        <Lbl c="Caratteristiche" style={{marginBottom:3}}/>
        <Inp value={dims} onChange={setDims} rows={2}
          placeholder="es. Ante scorrevoli, laccato opaco bianco, interno con ripiani e cassettiera, maniglie inox…"/>
      </div>
      {/* ── ANALYSIS UNIT ── */}
      <div style={{marginBottom:10,background:T.surf2,borderRadius:6,
        padding:"10px 12px",border:`1px solid ${T.blue}22`}}>
        <Lbl c="Unità di analisi commerciale" style={{marginBottom:6,color:T.blue2}}/>
        <div style={{fontSize:12,color:T.text3,marginBottom:8,lineHeight:1.4}}>
          Come vuoi misurare questo item? Serve per calcolare il prezzo unitario finale.
        </div>
        <div style={{display:"flex",gap:6,marginBottom: analysisUnit!=="pz" ? 10 : 0}}>
          {[["pz","📦 Pezzo"],["mq","⬜ Metro quad."],["ml","📏 Metro lin."]].map(([u,l])=>(
            <button key={u} onClick={()=>setAnalysisUnit(u)}
              style={{flex:1,padding:"7px 4px",borderRadius:5,cursor:"pointer",
                fontSize:11,fontWeight:600,
                background:analysisUnit===u?T.blue:`${T.blue}10`,
                color:analysisUnit===u?"#fff":T.text2,
                border:`1px solid ${analysisUnit===u?T.blue:T.border2}`}}>
              {l}
            </button>
          ))}
        </div>

        {/* MQ: chiede L×H, poi se qty>1 chiede se tutti uguali */}
        {analysisUnit==="mq" && (
          <div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <Lbl c="Larghezza (cm)" style={{marginBottom:3}}/>
                <Inp type="number" value={unitW} min={0} onChange={setUnitW}/>
              </div>
              <div>
                <Lbl c="Altezza (cm)" style={{marginBottom:3}}/>
                <Inp type="number" value={unitH} min={0} onChange={setUnitH}/>
              </div>
            </div>
            {qty > 1 && (
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,
                  padding:"7px 10px",background:T.surf3,borderRadius:5,
                  border:`1px solid ${T.border}`}}>
                  <span style={{fontSize:12,color:T.text2,flex:1}}>
                    Hai {qty} pezzi — sono tutti delle stesse misure?
                  </span>
                  <Btn v={piecesAllEqual?"primary":"ghost"} style={{fontSize:11,padding:"3px 10px"}}
                    onClick={()=>{ setPiecesAllEqual(true); setPieces([]); }}>Sì</Btn>
                  <Btn v={!piecesAllEqual?"primary":"ghost"} style={{fontSize:11,padding:"3px 10px"}}
                    onClick={()=>{
                      setPiecesAllEqual(false);
                      if(pieces.length===0) setPieces(Array.from({length:qty},(_,i)=>({id:String(i+1),w:unitW,h:unitH})));
                    }}>No</Btn>
                </div>
                {!piecesAllEqual && (
                  <div>
                    <Lbl c="Misure per ogni pezzo (cm)" style={{marginBottom:6}}/>
                    {pieces.map((p,i)=>(
                      <div key={p.id} style={{display:"grid",gridTemplateColumns:"30px 1fr 1fr 60px",
                        gap:6,marginBottom:5,alignItems:"center"}}>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
                          color:T.text3,textAlign:"center"}}>#{i+1}</span>
                        <Inp type="number" value={p.w||0} min={0}
                          onChange={v=>setPieces(ps=>ps.map((x,j)=>j===i?{...x,w:v}:x))}/>
                        <Inp type="number" value={p.h||0} min={0}
                          onChange={v=>setPieces(ps=>ps.map((x,j)=>j===i?{...x,h:v}:x))}/>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
                          color:T.green2,textAlign:"right"}}>
                          {(((p.w||0)/100)*((p.h||0)/100)).toFixed(2)}mq
                        </span>
                      </div>
                    ))}
                    <div style={{padding:"6px 10px",background:`${T.green}18`,borderRadius:4,
                      display:"flex",justifyContent:"space-between",marginTop:4}}>
                      <span style={{fontSize:11,color:T.text2}}>Totale mq</span>
                      <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,
                        color:T.green2,fontWeight:700}}>
                        {pieces.reduce((s,p)=>s+(((p.w||0)/100)*((p.h||0)/100)),0).toFixed(2)} mq
                      </span>
                    </div>
                  </div>
                )}
                {piecesAllEqual && unitW>0 && unitH>0 && (
                  <div style={{padding:"5px 10px",background:`${T.green}18`,borderRadius:4,
                    fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:T.green2}}>
                    {qty} × {((unitW/100)*(unitH/100)).toFixed(2)} mq = {(qty*(unitW/100)*(unitH/100)).toFixed(2)} mq totali
                  </div>
                )}
              </div>
            )}
            {qty===1 && unitW>0 && unitH>0 && (
              <div style={{padding:"5px 10px",background:`${T.green}18`,borderRadius:4,
                fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:T.green2}}>
                {((unitW/100)*(unitH/100)).toFixed(2)} mq
              </div>
            )}
          </div>
        )}

        {/* ML: chiede lunghezza */}
        {analysisUnit==="ml" && (
          <div>
            <div style={{marginBottom:8}}>
              <Lbl c="Lunghezza (cm)" style={{marginBottom:3}}/>
              <Inp type="number" value={unitL} min={0} onChange={setUnitL}/>
            </div>
            {qty > 1 && (
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,
                  padding:"7px 10px",background:T.surf3,borderRadius:5,
                  border:`1px solid ${T.border}`}}>
                  <span style={{fontSize:12,color:T.text2,flex:1}}>
                    Hai {qty} pezzi — stessa lunghezza?
                  </span>
                  <Btn v={piecesAllEqual?"primary":"ghost"} style={{fontSize:11,padding:"3px 10px"}}
                    onClick={()=>{ setPiecesAllEqual(true); setPieces([]); }}>Sì</Btn>
                  <Btn v={!piecesAllEqual?"primary":"ghost"} style={{fontSize:11,padding:"3px 10px"}}
                    onClick={()=>{
                      setPiecesAllEqual(false);
                      if(pieces.length===0) setPieces(Array.from({length:qty},(_,i)=>({id:String(i+1),l:unitL})));
                    }}>No</Btn>
                </div>
                {!piecesAllEqual && (
                  <div>
                    <Lbl c="Lunghezza per ogni pezzo (cm)" style={{marginBottom:6}}/>
                    {pieces.map((p,i)=>(
                      <div key={p.id} style={{display:"grid",gridTemplateColumns:"30px 1fr 60px",
                        gap:6,marginBottom:5,alignItems:"center"}}>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
                          color:T.text3,textAlign:"center"}}>#{i+1}</span>
                        <Inp type="number" value={p.l||0} min={0}
                          onChange={v=>setPieces(ps=>ps.map((x,j)=>j===i?{...x,l:v}:x))}/>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
                          color:T.green2,textAlign:"right"}}>
                          {((p.l||0)/100).toFixed(2)}ml
                        </span>
                      </div>
                    ))}
                    <div style={{padding:"6px 10px",background:`${T.green}18`,borderRadius:4,
                      display:"flex",justifyContent:"space-between",marginTop:4}}>
                      <span style={{fontSize:11,color:T.text2}}>Totale ml</span>
                      <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,
                        color:T.green2,fontWeight:700}}>
                        {pieces.reduce((s,p)=>s+((p.l||0)/100),0).toFixed(2)} ml
                      </span>
                    </div>
                  </div>
                )}
                {piecesAllEqual && unitL>0 && (
                  <div style={{padding:"5px 10px",background:`${T.green}18`,borderRadius:4,
                    fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:T.green2}}>
                    {qty} × {(unitL/100).toFixed(2)} ml = {(qty*unitL/100).toFixed(2)} ml totali
                  </div>
                )}
              </div>
            )}
            {qty===1 && unitL>0 && (
              <div style={{padding:"5px 10px",background:`${T.green}18`,borderRadius:4,
                fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:T.green2}}>
                {(unitL/100).toFixed(2)} ml
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{marginBottom:10}}>
        <Lbl c="Allega disegno, foto o PDF (opzionale)" style={{marginBottom:3}}/>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",
          background:T.surf2,border:`1px dashed ${imgFile?T.blue:T.border2}`,borderRadius:5,padding:"9px 10px"}}>
          <span style={{fontSize:16}}>{fileType==="pdf"?"📄":fileType==="image"?"🖼️":"📎"}</span>
          <span style={{fontSize:12,color:imgFile?T.text:T.text3,flex:1}}>
            {imgFile||"Carica disegno tecnico (PDF), foto o render…"}
          </span>
          {imgFile && (
            <span onClick={(e)=>{e.preventDefault();setImgFile(null);setImgB64(null);setFileType(null);}}
              style={{fontSize:14,color:T.text3,cursor:"pointer",padding:"0 4px"}}>✕</span>
          )}
          <input type="file" accept="image/*,application/pdf,.pdf" style={{display:"none"}} onChange={handleImg}/>
        </label>
        {imgFile && (
          <div style={{fontSize:10,color:T.blue2,marginTop:4,fontFamily:"'IBM Plex Mono',monospace"}}>
            {suggesting
              ? "⟳ Michi sta leggendo il file e compila i campi…"
              : (fileType==="pdf"?"Michi leggerà il disegno tecnico per ricavare misure e materiali":"Michi analizzerà l'immagine per la stima")}
          </div>
        )}
      </div>
      <button onClick={generateEstimate} disabled={loading||(!name.trim()&&!desc.trim())}
        style={{width:"100%",padding:"10px",borderRadius:6,cursor:"pointer",marginBottom:8,
          background:loading?T.surf2:`linear-gradient(135deg,${T.blue},#1a3a8c)`,
          border:`1px solid ${T.blue}`,color:loading?T.text2:"#fff",
          fontFamily:"'IBM Plex Sans',sans-serif",fontSize:13,fontWeight:700,
          opacity:(!name.trim()&&!desc.trim())?0.4:1,
          display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        {loading ? <><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span> Michi sta stimando…</> : <>✦ Genera stima AI</>}
      </button>

      {preview && (
        <div style={{background:T.surf2,border:`1px solid ${T.blue}44`,borderRadius:6,padding:12,marginBottom:8}}>
          <Lbl c="✦ Stima di Michi" style={{color:T.blue2,marginBottom:8}}/>
          {preview.description && (
            <div style={{fontSize:12,color:T.text,lineHeight:1.5,marginBottom:10,
              padding:"6px 10px",background:T.surf3,borderRadius:4,borderLeft:`3px solid ${T.blue2}`}}>
              {preview.description}
            </div>
          )}
          {/* Totals summary */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
            {[
              ["⏱ Ore tot.", `${(totH*qty).toFixed(1)}h`, T.blue2],
              ["🟢 Materiali", fmt(totMat*qty), T.green2],
              ["🟡 Esterni", fmt(totExt*qty), T.yellow2],
            ].map(([l,v,c])=>(
              <div key={l} style={{background:T.surf3,borderRadius:5,padding:"7px 8px",textAlign:"center"}}>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.text3,marginBottom:2}}>{l}</div>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,color:c,fontWeight:600}}>{v}</div>
              </div>
            ))}
          </div>
          {/* Phases */}
          {preview.phases?.map((ph,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",
              padding:"4px 8px",marginBottom:3,background:T.surf3,borderRadius:4}}>
              <span style={{fontSize:12,color:T.text}}>{ph.name}</span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:T.blue2}}>
                {(ph.subphases?.reduce((s,sp)=>s+(sp.hours||0),0)||0).toFixed(1)}h × {qty} pz
              </span>
            </div>
          ))}
          {preview.notes && (
            <div style={{fontSize:11,color:T.text3,fontStyle:"italic",
              padding:"5px 8px",borderTop:`1px solid ${T.border}`,marginTop:8}}>
              📝 {preview.notes}
            </div>
          )}
          <div style={{display:"flex",gap:6,marginTop:10}}>
            <Btn v="ok" style={{flex:1,justifyContent:"center"}} onClick={applyEstimate}>✓ Usa stima</Btn>
            <Btn v="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>{
              const it=mkItem(settings);it.name=name;it.description=desc;it.qty=qty;
              onAdd(it);setName("");setDesc("");setDims("");setQty(1);setPreview(null);setImgFile(null);setImgB64(null);
            }}>Aggiungi vuoto</Btn>
          </div>
        </div>
      )}
      {!preview && (
        <Btn v="ghost" style={{width:"100%",justifyContent:"center"}} onClick={()=>{
          if(!name.trim()) return;
          const it=mkItem(settings);it.name=name;it.description=desc;it.qty=qty;
          it.analysisUnit=analysisUnit;it.piecesAllEqual=piecesAllEqual;it.pieces=pieces;
          it.unitW=unitW;it.unitH=unitH;it.unitL=unitL;
          setName("");setDesc("");setQty(1);
          setAnalysisUnit("pz");setUnitW(0);setUnitH(0);setUnitL(0);
          setPiecesAllEqual(true);setPieces([]);
          onAdd(it);
        }}>+ Aggiungi senza stima</Btn>
      )}
    </div>
  );
};


// ─── PROJECT DETAIL ───────────────────────────────────────────────────────────
const ProjectDetail = ({project,onChange,onBack,globalSettings,onOpenSettings}) => {
  const [activeId,setActiveId] = useState(project.items[0]?.id||null);
  const [tab,setTab] = useState("items");
  const [michiMode,setMichiMode] = useState(project.items.length===0);

  const active = project.items.find(i=>i.id===activeId);

  const addItem = () => {
    const it = mkItem(project.settings);
    onChange(p=>({...p,items:[...p.items,it]}));
    setActiveId(it.id);
    setTab("edit");
  };
  const remItem = id => {
    onChange(p=>{
      const nx=p.items.filter(i=>i.id!==id);
      if(activeId===id) setActiveId(nx[0]?.id||null);
      return{...p,items:nx};
    });
    setTab("items");
  };
  const chItem = (id,upd) => onChange(p=>({...p,items:p.items.map(it=>it.id!==id?it:upd(it))}));

  const MF = ({label,val,onCh,ph,w=120}) => (
    <div style={{display:"flex",flexDirection:"column",gap:2}}>
      <Lbl c={label}/>
      <input value={val} onChange={e=>onCh(e.target.value)} placeholder={ph}
        style={{background:"none",border:"none",borderBottom:`1px solid ${T.border}`,
          color:T.text,fontFamily:"'IBM Plex Sans',sans-serif",fontSize:13,fontWeight:600,
          padding:"2px 3px",outline:"none",width:w}}
        onFocus={e=>e.target.style.borderBottomColor=T.blue2}
        onBlur={e=>e.target.style.borderBottomColor=T.border}/>
    </div>
  );

  if (michiMode) return (
    <MichiPanel
      project={project}
      settings={globalSettings}
      onChange={onChange}
      onDone={()=>setMichiMode(false)}
      onOpenSettings={()=>{ setMichiMode(false); onOpenSettings&&onOpenSettings(); }}
    />
  );

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:T.bg}}>
      <CSS/>
      <div style={{background:T.surf,borderBottom:`1px solid ${T.border}`,
        padding:"0 14px",height:50,display:"flex",alignItems:"center",
        justifyContent:"space-between",flexShrink:0}}>
        <button onClick={onBack}
          style={{background:"none",border:"none",cursor:"pointer",color:T.text2,
            fontFamily:"'IBM Plex Sans',sans-serif",fontSize:13,
            display:"flex",alignItems:"center",gap:4}}>
          ← Preventivi
        </button>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,letterSpacing:1}}>PREVENTIVO</div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setMichiMode(true)}
            style={{background:`${T.blue}18`,border:`1px solid ${T.blue}44`,
              borderRadius:5,padding:"4px 8px",cursor:"pointer",
              color:T.blue2,fontSize:11,fontWeight:600,
              display:"flex",alignItems:"center",gap:4}}>
            🧓 Michi
          </button>
          <Btn v="primary" style={{fontSize:11,padding:"4px 10px"}} onClick={addItem}>+ Item</Btn>
        </div>
      </div>

      <div style={{background:T.surf,borderBottom:`1px solid ${T.border}`,
        padding:"8px 14px",display:"flex",gap:12,flexWrap:"wrap",flexShrink:0}}>
        <MF label="Progetto" val={project.name} onCh={v=>onChange(p=>({...p,name:v}))} ph="Nome…" w={130}/>
        <MF label="Cliente"  val={project.client} onCh={v=>onChange(p=>({...p,client:v}))} ph="Azienda…" w={110}/>
        <MF label="Data"     val={project.date} onCh={v=>onChange(p=>({...p,date:v}))} ph="Data…" w={80}/>
        <MF label="Rif."     val={project.ref} onCh={v=>onChange(p=>({...p,ref:v}))} ph="n°…" w={60}/>
      </div>

      <div style={{background:T.surf2,borderBottom:`1px solid ${T.border}`,
        display:"flex",flexShrink:0}}>
        {[["items","📋 Items"],["edit","✏️ Dettaglio"],["summary","📊 Totali"]].map(([t,l]) => (
          <button key={t} onClick={()=>setTab(t)}
            style={{flex:1,padding:"9px 4px",background:"none",border:"none",cursor:"pointer",
              borderBottom:`2px solid ${tab===t?T.blue2:"transparent"}`,
              color:tab===t?T.blue2:T.text3,
              fontFamily:"'IBM Plex Sans',sans-serif",fontSize:12,fontWeight:600,
              transition:"all .15s"}}>
            {l}
          </button>
        ))}
      </div>

      <div style={{flex:1,overflow:"hidden"}}>
        {tab==="items" && (
          <div style={{height:"100%",overflowY:"auto",padding:10}}>
            {project.items.length===0
              ? (
                <div style={{textAlign:"center",color:T.text3,padding:"40px 20px"}}>
                  <div style={{fontSize:36,marginBottom:8,opacity:.3}}>📦</div>
                  <div style={{marginBottom:12}}>Nessun item ancora.</div>
                  <Btn v="primary" onClick={addItem}>+ Aggiungi il primo item</Btn>
                </div>
              )
              : project.items.map(it => {
                  const c = cItem(it,project.settings);
                  return (
                    <div key={it.id}
                      onClick={()=>{setActiveId(it.id);setTab("edit");}}
                      style={{background:T.surf,border:`1px solid ${it.id===activeId?T.blue2:T.border}`,
                        borderRadius:8,padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:14}}>{it.name||"—"}</div>
                          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
                            color:T.text3,marginTop:2}}>Qtà: {it.qty||1}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'IBM Plex Mono',monospace",
                            fontSize:14,color:T.green2,fontWeight:600}}>{fmt(c.price)}</div>
                          <div style={{fontFamily:"'IBM Plex Mono',monospace",
                            fontSize:10,color:T.text3}}>costo {fmt(c.cost)}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:8,
                        fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:T.text3}}>
                        <span>🔵 {fmt(c.pr.price)}</span>
                        <span>🟢 {fmt(c.ma.price)}</span>
                        <span>🟡 {fmt(c.ex.price)}</span>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        )}

        {tab==="edit" && (
          <div style={{height:"100%",overflowY:"auto",padding:"12px 14px"}}>
            {active
              ? <ItemEditor key={active.id} item={active}
                  onChange={upd=>chItem(active.id,upd)}
                  onRemove={()=>remItem(active.id)}/>
              : (
                <div style={{textAlign:"center",color:T.text3,padding:"40px 20px"}}>
                  <div style={{marginBottom:12}}>Seleziona un item dalla tab Items.</div>
                  <Btn v="ghost" onClick={()=>setTab("items")}>← Vai a Items</Btn>
                </div>
              )
            }
          </div>
        )}

        {tab==="summary" && (
          <div style={{height:"100%",overflowY:"auto"}}>
            <Summary project={project} onChange={onChange}/>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── PROJECT LIST ─────────────────────────────────────────────────────────────
const ProjectList = ({projects,globalSettings,onSelect,onNew,onDel,onSettings}) => {
  const [confirmDel, setConfirmDel] = useState(null);
  return (
  <div style={{maxWidth:640,margin:"0 auto",padding:"24px 16px"}}>
    <CSS/>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        {/* Simbolo Corrirossi (rosso) — placeholder logo */}
        <svg width="46" height="46" viewBox="0 0 100 100" style={{flexShrink:0}}>
          <path d="M50 8 C25 8 8 27 8 50 C8 73 25 92 50 92 C70 92 86 79 91 60"
            fill="none" stroke="#e30613" stroke-width="11" stroke-linecap="round"/>
          <path d="M88 64 C90 58 91 53 91 48"
            fill="none" stroke="#e30613" stroke-width="7" stroke-linecap="round"/>
        </svg>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:30,letterSpacing:-0.5,
            fontWeight:800,lineHeight:1,color:T.text}}>Michi</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,
            color:T.red2,letterSpacing:2,marginTop:3}}>ANALISI PREVENTIVI ARREDO</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <Btn v="ghost" onClick={onSettings} style={{fontSize:12}}>⚙ Impostazioni</Btn>
        <Btn v="primary" onClick={onNew} style={{fontSize:13,padding:"7px 14px"}}>+ Nuovo</Btn>
      </div>
    </div>

    {projects.length===0
      ? (
        <div style={{textAlign:"center",color:T.text3,padding:"60px 20px"}}>
          <div style={{fontSize:48,marginBottom:12,opacity:.3}}>📋</div>
          <div style={{fontSize:14,marginBottom:4}}>Nessun preventivo ancora.</div>
          <div style={{fontSize:12,color:T.text3}}>
            Usa il pulsante <strong style={{color:T.text2}}>+ Nuovo</strong> in alto per iniziare.
          </div>
        </div>
      )
      : projects.map(proj => {
          const p = cProj(proj);
          return (
            <div key={proj.id} onClick={()=>onSelect(proj.id)}
              style={{background:T.surf,border:`1px solid ${T.border}`,
                borderRadius:10,padding:"14px 16px",marginBottom:10,cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=T.blue2}
              onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:15,marginBottom:3,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {proj.name||"Senza nome"}
                  </div>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:T.text3}}>
                    {proj.client&&<span style={{marginRight:10}}>{proj.client}</span>}
                    {proj.date&&<span style={{marginRight:10}}>{proj.date}</span>}
                    {proj.ref&&<span>{proj.ref}</span>}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",
                    fontSize:15,color:T.green2,fontWeight:600}}>{fmt(p.price)}</div>
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:T.text3,marginTop:2}}>
                    {proj.items.length} item{proj.items.length!==1?"s":""}
                  </div>
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",marginTop:8,gap:6}}>
                {confirmDel===proj.id ? (
                  <>
                    <span style={{fontSize:11,color:T.text3,alignSelf:"center"}}>Sicuro?</span>
                    <button onClick={e=>{e.stopPropagation();onDel(proj.id);setConfirmDel(null);}}
                      style={{background:T.red2,border:"none",borderRadius:5,cursor:"pointer",
                        color:"#fff",fontSize:11,fontWeight:600,padding:"3px 10px",
                        fontFamily:"'IBM Plex Sans',sans-serif"}}>
                      Sì, elimina
                    </button>
                    <button onClick={e=>{e.stopPropagation();setConfirmDel(null);}}
                      style={{background:"none",border:`1px solid ${T.border2}`,borderRadius:5,cursor:"pointer",
                        color:T.text3,fontSize:11,padding:"3px 10px",
                        fontFamily:"'IBM Plex Sans',sans-serif"}}>
                      Annulla
                    </button>
                  </>
                ) : (
                  <button onClick={e=>{e.stopPropagation();setConfirmDel(proj.id);}}
                    style={{background:"none",border:"none",cursor:"pointer",
                      color:T.text3,fontSize:11,fontFamily:"'IBM Plex Sans',sans-serif"}}>
                    🗑 Elimina
                  </button>
                )}
              </div>
            </div>
          );
        })
    }
  </div>
  );
};

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const KEY_SETTINGS  = "preventivi_settings_v1";
const KEY_PROJECTS  = "preventivi_projects_v1";

// ─── FLOATING MICHI MASCOT ────────────────────────────────────────────────────
const MichiMascot = ({tip, onClose, actions=[], autoSpeak=true}) => {
  const [phase, setPhase]   = useState("hidden"); // hidden | big | corner
  const [waving, setWaving] = useState(false);
  const [showBubble, setShowBubble] = useState(false);

  useEffect(()=>{
    const t1 = setTimeout(()=>{ setPhase("big"); setWaving(true); }, 300);
    const t2 = setTimeout(()=>setShowBubble(true), 900);
    const t3 = setTimeout(()=>setWaving(false), 3000);
    return ()=>{ [t1,t2,t3].forEach(clearTimeout); };
  },[]);

  // L'audio dei browser è bloccato finché l'utente non interagisce.
  // Quindi facciamo parlare Michi al PRIMO tocco/click sulla pagina.
  useEffect(()=>{
    if (!autoSpeak || !tip) return;
    let spoken = false;
    const speakOnce = () => {
      if (spoken) return;
      spoken = true;
      try { speak(tip); } catch(e){}
      window.removeEventListener("click", speakOnce);
      window.removeEventListener("touchstart", speakOnce);
    };
    window.addEventListener("click", speakOnce);
    window.addEventListener("touchstart", speakOnce);
    return ()=>{
      window.removeEventListener("click", speakOnce);
      window.removeEventListener("touchstart", speakOnce);
    };
  },[tip, autoSpeak]);

  const isBig    = phase === "big";
  const isCorner = phase === "corner";
  const isHidden = phase === "hidden";

  const svgW = isBig ? 120 : 60;
  const svgH = isBig ? 180 : 90;

  const wakeUp = () => { setPhase("big"); setWaving(true); setShowBubble(true);
    if (autoSpeak && tip) { try { speakOrus(tip); } catch(e){} }
    setTimeout(()=>setWaving(false), 2500); };

  // Quando l'utente sceglie un'azione, Michi si ritira nell'angolo
  const handleAction = (fn) => { setPhase("corner"); setShowBubble(false); fn && fn(); };

  return (
    <div style={{
      position:"fixed",
      bottom: isBig ? 30 : 18,
      right: isBig ? "50%" : 16,
      transform: isHidden
        ? "translate(0, 140%) scale(.6)"
        : isBig
          ? "translate(50%, 0) scale(1)"
          : "translate(0, 0) scale(1)",
      zIndex:1000,
      display:"flex", alignItems:"flex-end", gap:10,
      opacity: isHidden ? 0 : 1,
      transition:"all .6s cubic-bezier(.2,.85,.25,1)",
      maxWidth:"calc(100vw - 32px)",
    }}>
      {tip && showBubble && (
        <div style={{
          background:T.surf2, border:`1px solid ${T.blue}55`,
          borderRadius:"14px 14px 0 14px",
          padding: isBig ? "14px 16px" : "10px 13px",
          maxWidth: isBig ? 270 : 200, marginBottom:8,
          boxShadow:"0 10px 30px rgba(0,0,0,.5)", position:"relative",
          transition:"all .4s",
        }}>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,
            color:T.blue2,letterSpacing:1,marginBottom:5}}>MICHI</div>
          <div style={{fontSize: isBig ? 14 : 12,color:T.text,lineHeight:1.5,marginBottom: actions.length?10:0}}>{tip}</div>
          {isBig && actions.map((a,i)=>(
            <button key={i} onClick={()=>handleAction(a.onClick)}
              style={{marginTop:i?6:0,background: a.primary?T.blue:"transparent",
                border:`1px solid ${a.primary?T.blue:T.border2}`,borderRadius:6,
                cursor:"pointer",color: a.primary?"#fff":T.text2,fontSize:12,fontWeight:600,
                padding:"8px 13px",fontFamily:"'IBM Plex Sans',sans-serif",width:"100%",
                display:"block"}}>
              {a.label}
            </button>
          ))}
          <button onClick={onClose}
            style={{position:"absolute",top:7,right:9,background:"none",border:"none",
              cursor:"pointer",color:T.text3,fontSize:14,lineHeight:1}}>×</button>
        </div>
      )}

      <div style={{flexShrink:0,filter:"drop-shadow(0 8px 16px rgba(0,0,0,.5))",cursor:"pointer",
        transition:"all .5s",position:"relative"}}
        onClick={isCorner ? wakeUp : ()=>setWaving(true)}>
        <svg width={svgW} height={svgH} viewBox="0 0 80 120" style={{transition:"all .5s"}}>
          <rect x="30" y="84" width="9" height="26" rx="4" fill="#4A3728"/>
          <rect x="41" y="84" width="9" height="26" rx="4" fill="#4A3728"/>
          <ellipse cx="34" cy="110" rx="6" ry="3.5" fill="#1A1A1A"/>
          <ellipse cx="46" cy="110" rx="6" ry="3.5" fill="#1A1A1A"/>
          <rect x="26" y="50" width="28" height="38" rx="6" fill="#7B9CB5"/>
          <path d="M31 54 L49 54 L51 86 L29 86 Z" fill="#A0791A"/>
          <rect x="35" y="64" width="10" height="8" rx="2" fill="#7A5F10"/>
          {/* Braccio sinistro (fisso, lungo il corpo) */}
          <path d="M28 54 Q22 66 21 78" stroke="#7B9CB5" strokeWidth="8" strokeLinecap="round"/>
          <ellipse cx="21" cy="80" rx="4.5" ry="4" fill="#D4956A"/>
          {/* Braccio destro: fermo lungo il corpo, oppure alzato per salutare */}
          {waving ? (
            <g style={{transformOrigin:"52px 54px", transition:"transform .3s"}}>
              <path d="M52 54 Q62 48 65 38" stroke="#7B9CB5" strokeWidth="8" strokeLinecap="round"/>
              <ellipse cx="65" cy="36" rx="5" ry="4.5" fill="#D4956A"/>
            </g>
          ) : (
            <g>
              <path d="M52 54 Q58 66 59 78" stroke="#7B9CB5" strokeWidth="8" strokeLinecap="round"/>
              <ellipse cx="59" cy="80" rx="4.5" ry="4" fill="#D4956A"/>
            </g>
          )}
          <rect x="35" y="38" width="10" height="14" rx="4" fill="#D4956A"/>
          <ellipse cx="40" cy="26" rx="18" ry="19" fill="#D4956A"/>
          <path d="M22 22 Q20 14 24 9 Q26 6 29 8 Q24 13 24 22 Z" fill="#B0B8C0"/>
          <path d="M58 22 Q60 14 56 9 Q54 6 51 8 Q56 13 56 22 Z" fill="#B0B8C0"/>
          <ellipse cx="40" cy="11" rx="10" ry="5" fill="#C8CCCE" opacity="0.25"/>
          <path d="M27 20 Q31 17 35 19" stroke="#5A4030" strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M45 19 Q49 17 53 20" stroke="#5A4030" strokeWidth="2" strokeLinecap="round" fill="none"/>
          <ellipse cx="33" cy="24" rx="3.5" ry="3.5" fill="white"/>
          <ellipse cx="47" cy="24" rx="3.5" ry="3.5" fill="white"/>
          <circle cx="33" cy="24.5" r="2.2" fill="#3D2510"/>
          <circle cx="47" cy="24.5" r="2.2" fill="#3D2510"/>
          <circle cx="33" cy="25" r="1.1" fill="#1A0E08"/>
          <circle cx="47" cy="25" r="1.1" fill="#1A0E08"/>
          <circle cx="34" cy="23.2" r="0.7" fill="white"/>
          <circle cx="48" cy="23.2" r="0.7" fill="white"/>
          <circle cx="36.5" cy="31" r="2" fill="#C8855A" opacity="0.5"/>
          <circle cx="43.5" cy="31" r="2" fill="#C8855A" opacity="0.5"/>
          <path d="M33 36 Q40 40 47 36" stroke="#8B5535" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
          <ellipse cx="22" cy="26" rx="3" ry="4" fill="#C8855A"/>
          <ellipse cx="58" cy="26" rx="3" ry="4" fill="#C8855A"/>
        </svg>
        {isCorner && (
          <div style={{position:"absolute",top:-2,right:-2,width:14,height:14,
            borderRadius:"50%",background:T.green2,border:`2px solid ${T.bg}`,
            animation:"michi-dot 2s infinite"}}/>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [settings,setSettings] = useState(() => {
    try {
      const s = localStorage.getItem(KEY_SETTINGS);
      if (s) {
        const parsed = JSON.parse(s);
        // If db is missing or empty, inject the default db
        if (!parsed.db || parsed.db.length === 0) {
          parsed.db = DEFAULT_DB.map(d=>({...d}));
        }
        return parsed;
      }
      return mkSettings();
    } catch { return mkSettings(); }
  });
  const [projects,setProjects] = useState(() => {
    try {
      const s=localStorage.getItem(KEY_PROJECTS);
      const all = s?JSON.parse(s):[];
      // Rimuovi i preventivi vuoti (0 items e nome di default) rimasti dai test
      return all.filter(p => p.items?.length > 0 || (p.name && p.name !== "Nuovo Preventivo") || p.client);
    }
    catch { return []; }
  });
  const [view,setView] = useState("list"); // "list" | "settings" | projectId
  const [mascotClosed, setMascotClosed] = useState(false);
  const [isFirstVisit] = useState(() => {
    try {
      const seen = localStorage.getItem("michi_welcomed");
      if (!seen) { localStorage.setItem("michi_welcomed", "1"); return true; }
      return false;
    } catch { return false; }
  });

  useEffect(()=>{ try{localStorage.setItem(KEY_SETTINGS,JSON.stringify(settings));}catch{} },[settings]);
  useEffect(()=>{ try{localStorage.setItem(KEY_PROJECTS,JSON.stringify(projects));}catch{} },[projects]);

  const addProject = () => {
    const p = mkProj(settings);
    setProjects(prev=>[p,...prev]);
    setView(p.id);
  };
  const delProject = id => {
    setProjects(prev=>prev.filter(p=>p.id!==id));
    if (view===id) setView("list");
  };
  const chProject = (id,upd) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = upd(p);
      // sync db changes back to global settings
      if (updated.settings?.db && updated.settings.db !== p.settings?.db) {
        setSettings(s => ({...s, db: updated.settings.db}));
      }
      return updated;
    }));
  };

  const activeProject = projects.find(p=>p.id===view);

  if (view==="settings") {
    return (
      <SettingsView
        settings={settings}
        onChange={setSettings}
        onBack={()=>setView("list")}
      />
    );
  }

  if (activeProject) {
    return (
      <ProjectDetail
        key={activeProject.id}
        project={activeProject}
        onChange={upd=>chProject(activeProject.id,upd)}
        onBack={()=>setView("list")}
        globalSettings={settings}
        onOpenSettings={()=>setView("settings")}
      />
    );
  }

  return (
    <>
    <ProjectList
      projects={projects}
      globalSettings={settings}
      onSelect={setView}
      onNew={addProject}
      onDel={delProject}
      onSettings={()=>setView("settings")}
    />
    {!mascotClosed && (
      <MichiMascot
        tip={isFirstVisit
          ? "Ciao, sono Michi! Piacere di conoscerti. Sono qui per aiutarti a costruire preventivi precisi, voce e tutto. " + (projects.length===0 ? "Partiamo dal primo?" : "Dimmi pure da dove cominciare.")
          : contextualGreeting(projects.length>0)}
        actions={projects.length===0
          ? [
              {label:"➜ Creiamo il primo preventivo", primary:true, onClick:()=>addProject()},
            ]
          : [
              {label:"➜ Nuovo preventivo", primary:true, onClick:()=>addProject()},
              {label:"📂 Analizza un preventivo esistente", onClick:()=>{
                const last = projects[0]; if(last) setView(last.id);
              }},
            ]}
        onClose={()=>setMascotClosed(true)}
      />
    )}
    </>
  );
}
