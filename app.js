/* Asignación de títulos a evaluadores (ANECA · Comisión de Ingeniería)
 * Aplicación 100 % en el navegador. Ningún dato sale del equipo.
 */
(function () {
'use strict';

// ---------------------------------------------------------------- constantes
const NIVELES = ['Grado', 'Máster'];
const ACCIONES = ['Verificación', 'Modificación', 'Seguimiento', 'Alegación a Verificación', 'Alegación a Modificación'];
const ACC_CORTO = { 'Verificación': 'Verifica', 'Modificación': 'Modifica', 'Seguimiento': 'Seguimiento', 'Alegación a Verificación': 'AleVerifica', 'Alegación a Modificación': 'AleModifica' };
// Esfuerzo de un título = peso del nivel × peso del tipo de evaluación
const DEFAULT_WEIGHTS = {
  nivel: { 'Grado': 0.66, 'Máster': 0.33 },
  accion: { 'Verificación': 0.4, 'Modificación': 0.1, 'Seguimiento': 0.5, 'Alegación a Verificación': 0.6, 'Alegación a Modificación': 0.4 }
};
const DEFAULT_PARAMS = { k: 2, student: true, alpha: 60, conflict: true, onlyAffine: true };
const STORE_KEY = 'asignacionesAneca.v2';

const EVAL_FIELDS = [
  { key: 'nombre', label: 'Nombre *', req: true, pats: ['nombre y apellidos', 'evaluador', 'nombre', 'experto'] },
  { key: 'apellidos', label: 'Apellidos', pats: ['apellidos', 'apellido'] },
  { key: 'area', label: 'Área / ámbito *', req: true, pats: ['area de conocimiento', 'ambito de conocimiento', 'area', 'ambito', 'conocimiento', 'especialidad'] },
  { key: 'rol', label: 'Perfil (académico / estudiante)', pats: ['perfil', 'rol', 'vocal', 'colectivo', 'tipo', 'categoria', 'cargo'] },
  { key: 'universidad', label: 'Universidad', pats: ['universidad', 'institucion', 'centro', 'organismo'] },
  { key: 'capacidad', label: 'Capacidad (peso)', pats: ['capacidad', 'disponibilidad', 'peso', 'carga maxima'] },
  { key: 'email', label: 'Email', pats: ['email', 'correo', 'e-mail', 'mail'] }
];
const TIT_FIELDS = [
  { key: 'codigo', label: 'Código / RUCT', pats: ['ruct', 'codigo', 'expediente', 'id'] },
  { key: 'denominacion', label: 'Denominación *', req: true, pats: ['denominacion', 'titulo', 'titulacion', 'nombre'] },
  { key: 'nivel', label: 'Nivel (Grado/Máster)', pats: ['nivel', 'tipo de titulo', 'ciclo'] },
  { key: 'accion', label: 'Tipo de evaluación', pats: ['tipo de evaluacion', 'evaluacion', 'procedimiento', 'accion', 'fase', 'tramite', 'tipo'] },
  { key: 'universidad', label: 'Universidad', pats: ['universidad', 'institucion', 'centro'] },
  { key: 'rama', label: 'Rama / ámbito', pats: ['rama', 'ambito', 'area', 'campo'] }
];

const STOP = new Set(('de del la las el los en y e o u a al por para con sin su sus un una ' +
  'grado master maste graduado graduada ingenieria ingeniero ingeniera universidad universitario ' +
  'universitaria interuniversitario oficial titulo estudios doble mencion especialidad ciencias').split(' '));

// ---------------------------------------------------------------- estado
let S = freshState();
function freshState() {
  return {
    evalRaw: null, titRaw: null,
    mapEval: {}, mapTit: {},
    weights: JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)),
    params: { ...DEFAULT_PARAMS },
    keywords: {},            // área (texto original) -> "kw1, kw2"
    titOverrides: {},        // idTítulo -> {nivel, accion}
    evalOverrides: {},       // idEvaluador -> {estudiante: bool}
    asg: {},                 // idTítulo -> [idEval | null, ...]  (0..k-1 académicos, k = vocal estudiante)
    locks: {},               // idTítulo -> [bool, ...]
    lastRun: null
  };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { console.warn('No se pudo guardar', e); }
}
function load() {
  try {
    const t = localStorage.getItem(STORE_KEY);
    if (t) S = Object.assign(freshState(), JSON.parse(t));
  } catch (e) { console.warn('No se pudo leer el estado guardado', e); }
}

// ---------------------------------------------------------------- utilidades
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
const fmt = (n) => (Math.round(n * 1000) / 1000).toLocaleString('es-ES');
const tokens = (s) => norm(s).split(' ').filter(w => w && !STOP.has(w));
const K_ = () => Math.max(1, parseInt(S.params.k) || 1);
const NSLOT = () => K_() + (S.params.student ? 1 : 0);
const isStudentSlot = (s) => S.params.student && s === K_();
const slotName = (s) => isStudentSlot(s) ? 'Vocal estudiante' : 'Evaluador ' + (s + 1);

function tokMatch(a, b) {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m < 4) return false;
  let p = 0; while (p < m && a[p] === b[p]) p++;
  if (p >= Math.max(4, m - 2)) return true;               // mecanica ~ mecanico, telecomunicacion ~ telecomunicaciones
  if (m >= 6 && (a.includes(b) || b.includes(a))) return true; // telecomunicacion ~ comunicacion
  return false;
}
function phraseIn(phraseToks, titleToks) {
  return phraseToks.length > 0 && phraseToks.every(p => titleToks.some(t => tokMatch(p, t)));
}
function splitAreas(s) {
  return String(s || '').split(/[;\n|]+/).map(x => x.trim()).filter(Boolean);
}

function detectMap(headers, fields) {
  const m = {}; const used = new Set();
  const nh = headers.map(norm);
  for (const f of fields) {
    for (const p of f.pats) {
      const i = nh.findIndex((h, idx) => !used.has(idx) && (h === p || h.includes(p)));
      if (i >= 0) { m[f.key] = headers[i]; used.add(i); break; }
    }
  }
  return m;
}

function parseNivel(v, denom) {
  for (const n of [norm(v), norm(denom).split(' ').slice(0, 3).join(' ')]) {
    if (/master|\bmu\b/.test(n)) return 'Máster';
    if (/grad/.test(n)) return 'Grado';
  }
  return '';
}
function parseAccion(v) {
  const n = norm(v);
  if (/aleg|^ale/.test(n)) return /modif/.test(n) ? 'Alegación a Modificación' : 'Alegación a Verificación';
  if (/verif/.test(n)) return 'Verificación';
  if (/segui/.test(n)) return 'Seguimiento';
  if (/modif/.test(n)) return 'Modificación';
  return '';
}
const isStudentText = (v) => /estudian|alumn/.test(norm(v));

// ---------------------------------------------------------------- modelo derivado
function getEvaluators() {
  if (!S.evalRaw) return [];
  const m = S.mapEval;
  return S.evalRaw.rows.map((r, i) => {
    const id = 'e' + i;
    const nombre = [r[m.nombre], m.apellidos ? r[m.apellidos] : ''].filter(Boolean).join(' ').trim();
    let cap = m.capacidad ? parseFloat(String(r[m.capacidad]).replace(',', '.')) : 1;
    if (!isFinite(cap) || cap < 0) cap = 1;
    const areaTxt = m.area ? r[m.area] : '';
    const ov = S.evalOverrides[id] || {};
    const estudiante = ov.estudiante != null ? ov.estudiante : isStudentText((m.rol ? r[m.rol] : '') + ' ' + areaTxt);
    return {
      id, nombre: nombre || ('Evaluador ' + (i + 1)), estudiante,
      areas: splitAreas(areaTxt).filter(a => !isStudentText(a)),
      uni: m.universidad ? String(r[m.universidad] || '').trim() : '',
      email: m.email ? String(r[m.email] || '') : '',
      cap
    };
  });
}
function effortOf(nivel, accion) {
  const a = S.weights.nivel[nivel], b = S.weights.accion[accion];
  return (a != null && b != null) ? Number(a) * Number(b) : 0;
}
function getTitles() {
  if (!S.titRaw) return [];
  const m = S.mapTit;
  return S.titRaw.rows.map((r, i) => {
    const id = 't' + i;
    const denom = String(r[m.denominacion] || '').trim();
    const ov = S.titOverrides[id] || {};
    const nivel = ov.nivel || parseNivel(m.nivel ? r[m.nivel] : '', denom);
    const accion = ov.accion || parseAccion(m.accion ? r[m.accion] : '');
    return {
      id, denom, nivel, accion, effort: effortOf(nivel, accion),
      codigo: m.codigo ? String(r[m.codigo] || '') : '',
      uni: m.universidad ? String(r[m.universidad] || '').trim() : '',
      rama: m.rama ? String(r[m.rama] || '') : ''
    };
  }).filter(t => t.denom);
}
function allAreas(evals) {
  const set = new Map();
  for (const e of evals) if (!e.estudiante) for (const a of e.areas) {
    const k = norm(a); if (!set.has(k)) set.set(k, { name: a, n: 0 }); set.get(k).n++;
  }
  return [...set.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
function keywordsFor(area) {
  if (S.keywords[area] != null) return S.keywords[area];
  const k = norm(area);
  for (const [name, kw] of Object.entries(window.DEFAULT_KEYWORDS || {})) if (norm(name) === k) return kw;
  return '';
}
function areaPhrases(area) {
  return [area, ...keywordsFor(area).split(',')].map(tokens).filter(t => t.length);
}

// afinidad: nº de palabras clave del área encontradas en el título (máximo sobre las áreas del evaluador)
function buildAffinity(evals, titles) {
  const phr = {};
  for (const e of evals) for (const a of e.areas) if (!phr[a]) phr[a] = areaPhrases(a);
  const aff = {};
  for (const t of titles) {
    const tt = tokens(t.denom + ' ' + t.rama);
    aff[t.id] = {};
    for (const e of evals) {
      let best = 0;
      for (const a of e.areas) {
        let h = 0; for (const p of phr[a]) if (phraseIn(p, tt)) h++;
        if (h > best) best = h;
      }
      aff[t.id][e.id] = best;
    }
  }
  return aff;
}
const affVal = (h) => h <= 0 ? 0 : h === 1 ? 0.6 : h === 2 ? 0.85 : 1;
const affLevel = (h) => h <= 0 ? 0 : h === 1 ? 1 : 2;
const AFF_TXT = ['Sin afinidad', 'Media', 'Alta'];

function uniConflict(t, e) {
  if (!t.uni || !e.uni) return false;
  const eu = norm(e.uni);
  return t.uni.split(/[;\n|]+|\s\/\s/).map(norm).filter(Boolean).some(u => u === eu || u.includes(eu) || eu.includes(u));
}

// ---------------------------------------------------------------- algoritmo
// Optimiza un "grupo" de plazas (p.ej. las 2 de académicos, o la del vocal estudiante)
// minimizando  wA·Σ(1 − afinidad) + Σ_j ((carga_j − objetivo_j)/esfuerzo_medio)²
function optimizePool(titles, pool, slotIdx, useAff, aff, asg) {
  const wA = useAff ? 0.1 + 0.1 * Number(S.params.alpha) : 0;
  const E = {}; pool.forEach(e => E[e.id] = e);
  const nS = slotIdx.length;

  const cand = {};
  for (const t of titles) {
    let c = pool.filter(e => !(S.params.conflict && uniConflict(t, e)));
    if (useAff && S.params.onlyAffine) {
      const a = c.filter(e => aff[t.id][e.id] > 0);
      if (a.length >= nS) c = a;
    }
    cand[t.id] = new Set(c.map(e => e.id));
  }
  const D = titles.reduce((s, t) => s + t.effort * nS, 0);
  const capSum = pool.reduce((s, e) => s + e.cap, 0) || 1;
  const T = {}; pool.forEach(e => T[e.id] = D * e.cap / capSum);
  const meanE = D / Math.max(1, titles.length * nS) || 1;
  const L = {}; pool.forEach(e => L[e.id] = 0);
  const balD = (j, de) => { const a = (L[j] - T[j]) / meanE, b = (L[j] + de - T[j]) / meanE; return b * b - a * a; };
  const affC = (t, j) => useAff ? wA * (1 - affVal(aff[t.id][j])) : 0;
  const locked = (t, s) => !!(S.locks[t.id] || [])[s];

  for (const t of titles) {
    const prev = S.asg[t.id] || [];
    for (const s of slotIdx) if (locked(t, s) && prev[s] && E[prev[s]]) { asg[t.id][s] = prev[s]; L[prev[s]] += t.effort; }
  }
  const order = [...titles].sort((a, b) => (cand[a.id].size - cand[b.id].size) || (b.effort - a.effort));
  for (const t of order) for (const s of slotIdx) {
    if (asg[t.id][s]) continue;
    let best = null, bc = Infinity;
    for (const j of cand[t.id]) {
      if (asg[t.id].includes(j)) continue;
      const c = affC(t, j) + balD(j, t.effort);
      if (c < bc) { bc = c; best = j; }
    }
    asg[t.id][s] = best;
    if (best) L[best] += t.effort;
  }

  const slots = [];
  for (const t of titles) for (const s of slotIdx) if (asg[t.id][s] && !locked(t, s)) slots.push([t, s]);
  let improved = true, pass = 0;
  while (improved && pass++ < 60) {
    improved = false;
    for (const [t, s] of slots) {                       // mover
      const a = asg[t.id][s]; const e = t.effort;
      let best = null, bd = -1e-9;
      L[a] -= e;
      const back = ((L[a] + e - T[a]) / meanE) ** 2 - ((L[a] - T[a]) / meanE) ** 2;
      for (const b of cand[t.id]) {
        if (b === a || asg[t.id].includes(b)) continue;
        const d = affC(t, b) - affC(t, a) + balD(b, e) - back;
        if (d < bd) { bd = d; best = b; }
      }
      L[a] += e;
      if (best) { asg[t.id][s] = best; L[a] -= e; L[best] += e; improved = true; }
    }
    for (let i = 0; i < slots.length; i++) {            // intercambiar
      const [t1, s1] = slots[i];
      for (let k = i + 1; k < slots.length; k++) {
        const [t2, s2] = slots[k];
        const a = asg[t1.id][s1], b = asg[t2.id][s2];
        if (a === b || !cand[t1.id].has(b) || !cand[t2.id].has(a)) continue;
        if (asg[t1.id].includes(b) || asg[t2.id].includes(a)) continue;
        const de = t2.effort - t1.effort;                // a gana de, b pierde de
        const dAff = affC(t1, b) + affC(t2, a) - affC(t1, a) - affC(t2, b);
        const d = dAff + balD(a, de) + balD(b, -de);
        if (d < -1e-9) { asg[t1.id][s1] = b; asg[t2.id][s2] = a; L[a] += de; L[b] -= de; improved = true; }
      }
    }
  }
}

function computeAssignment() {
  const all = getEvaluators().filter(e => e.cap > 0);
  const titles = getTitles();
  const aff = buildAffinity(all, titles);
  const K = K_(), N = NSLOT();
  const asg = {};
  titles.forEach(t => asg[t.id] = new Array(N).fill(null));
  optimizePool(titles, all.filter(e => !e.estudiante), [...Array(K).keys()], true, aff, asg);
  if (S.params.student) optimizePool(titles, all.filter(e => e.estudiante), [K], false, aff, asg);
  S.asg = asg;
  S.lastRun = new Date().toISOString();
  save();
}

// estadísticas de una asignación
function stats() {
  const evals = getEvaluators(), titles = getTitles();
  const K = K_(), N = NSLOT();
  const aff = buildAffinity(evals, titles);
  const per = {};
  evals.forEach(e => per[e.id] = { e, load: 0, n: 0, target: 0, items: [] });
  for (const grp of [false, true]) {
    if (grp && !S.params.student) continue;
    const pool = evals.filter(e => e.estudiante === grp && e.cap > 0);
    const D = titles.reduce((s, t) => s + t.effort * (grp ? 1 : K), 0);
    const cs = pool.reduce((s, e) => s + e.cap, 0) || 1;
    pool.forEach(e => per[e.id].target = D * e.cap / cs);
  }
  let slots = 0, empty = 0, lv = [0, 0, 0], conflicts = 0, emptyStu = 0;
  for (const t of titles) {
    const a = S.asg[t.id] || [];
    for (let s = 0; s < N; s++) {
      const j = a[s];
      if (isStudentSlot(s)) { if (!j || !per[j]) emptyStu++; }
      else { slots++; if (!j || !per[j]) empty++; }
      if (!j || !per[j]) continue;
      per[j].load += t.effort; per[j].n++; per[j].items.push(t);
      if (!isStudentSlot(s)) lv[affLevel(aff[t.id][j])]++;
      if (uniConflict(t, per[j].e)) conflicts++;
    }
  }
  const acad = evals.filter(e => !e.estudiante && e.cap > 0).map(e => per[e.id].load - per[e.id].target);
  const dev = acad.length ? Math.sqrt(acad.reduce((s, x) => s + x * x, 0) / acad.length) : 0;
  const D = titles.reduce((s, t) => s + t.effort, 0);
  return { evals, titles, aff, per, K, N, D, slots, empty, emptyStu, lv, conflicts, dev };
}

// ---------------------------------------------------------------- lectura de ficheros
function readFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        // primera fila con al menos 2 celdas no vacías = cabecera
        let h = aoa.findIndex(r => r.filter(c => String(c).trim()).length >= 2);
        if (h < 0) throw new Error('No se encontró la fila de cabecera');
        const headers = aoa[h].map((c, i) => String(c).trim() || ('Columna ' + (i + 1)));
        const rows = aoa.slice(h + 1).filter(r => r.some(c => String(c).trim()))
          .map(r => Object.fromEntries(headers.map((hd, i) => [hd, r[i] == null ? '' : String(r[i]).trim()])));
        res({ headers, rows, fileName: file.name, sheet: wb.SheetNames[0] });
      } catch (e) { rej(e); }
    };
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------- render: datos
function renderMapping(el, raw, fields, map, onChange) {
  if (!raw) { el.innerHTML = '<span class="muted">Sin fichero cargado.</span>'; return; }
  el.innerHTML = `<span class="muted" style="grid-column:1/-1">${esc(raw.fileName)} · hoja «${esc(raw.sheet)}» · ${raw.rows.length} filas. Revisa qué columna corresponde a cada campo:</span>` +
    fields.map(f => `<label for="m_${el.id}_${f.key}">${esc(f.label)}</label>
      <select id="m_${el.id}_${f.key}" data-k="${f.key}"><option value="">— (ninguna) —</option>
      ${raw.headers.map(h => `<option ${map[f.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('');
  el.querySelectorAll('select').forEach(sel => sel.onchange = () => { map[sel.dataset.k] = sel.value || undefined; onChange(); });
}

function renderDatos() {
  renderMapping($('#mapEval'), S.evalRaw, EVAL_FIELDS, S.mapEval, () => { S.asg = {}; S.locks = {}; S.evalOverrides = {}; save(); renderAll(); });
  renderMapping($('#mapTit'), S.titRaw, TIT_FIELDS, S.mapTit, () => { S.asg = {}; S.locks = {}; save(); renderAll(); });
  const ev = getEvaluators(), ti = getTitles();
  if (S.evalRaw) {
    const ar = allAreas(ev); const stu = ev.filter(e => e.estudiante).length;
    const noArea = ev.filter(e => !e.estudiante && !e.areas.length).length;
    $('#sumEval').innerHTML = `<b>${ev.length - stu}</b> evaluadores académicos · <b>${stu}</b> vocal(es) estudiante · <b>${ar.length}</b> áreas distintas` +
      (noArea ? ` · <span class="bad">${noArea} académicos sin área</span>` : '') +
      (S.params.student && !stu ? ' · <span class="bad">No hay ningún vocal estudiante marcado (márcalo en la vista previa)</span>' : '') +
      (S.mapEval.nombre && S.mapEval.area ? '' : ' · <span class="bad">Falta indicar columnas obligatorias</span>');
  } else $('#sumEval').innerHTML = '';
  if (S.titRaw) {
    const bad = ti.filter(t => !t.nivel || !t.accion).length;
    const cnt = {}; ti.forEach(t => { const k = (t.nivel || '?') + ' · ' + (ACC_CORTO[t.accion] || '?'); cnt[k] = (cnt[k] || 0) + 1; });
    $('#sumTit').innerHTML = `<b>${ti.length}</b> títulos` +
      (bad ? ` · <span class="bad">${bad} sin nivel o tipo de evaluación reconocido (corrígelos en la vista previa)</span>` : ' · <span class="ok">todos reconocidos</span>') +
      `<br><span class="muted">${Object.entries(cnt).map(([k, v]) => esc(k) + ': ' + v).join(' · ')}</span>`;
  } else $('#sumTit').innerHTML = '';
  renderPreview();
}

function renderPreview() {
  const which = document.querySelector('input[name=prev]:checked').value;
  const el = $('#preview');
  if (which === 'eval') {
    const ev = getEvaluators();
    if (!ev.length) { el.innerHTML = '<p class="muted" style="padding:8px">Carga la Excel de evaluadores.</p>'; return; }
    el.innerHTML = `<table><thead><tr><th>#</th><th>Nombre</th><th>Estudiante</th><th>Área(s)</th><th>Universidad</th><th class="num">Capacidad</th></tr></thead><tbody>` +
      ev.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.nombre)}</td><td><input type="checkbox" data-id="${e.id}" ${e.estudiante ? 'checked' : ''}></td>
        <td>${e.areas.map(esc).join('<br>') || (e.estudiante ? '' : '<span class="bad">—</span>')}</td><td>${esc(e.uni)}</td><td class="num">${fmt(e.cap)}</td></tr>`).join('') + '</tbody></table>';
    el.querySelectorAll('input[type=checkbox]').forEach(c => c.onchange = () => {
      S.evalOverrides[c.dataset.id] = { estudiante: c.checked }; S.asg = {}; S.locks = {}; save(); renderDatos();
    });
  } else {
    const ti = getTitles();
    if (!ti.length) { el.innerHTML = '<p class="muted" style="padding:8px">Carga la Excel de títulos.</p>'; return; }
    const sel = (id, k, opts, v) => `<select data-id="${id}" data-k="${k}" class="${v ? '' : 'bad'}"><option value="">?</option>${opts.map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${k === 'accion' ? ACC_CORTO[o] : o}</option>`).join('')}</select>`;
    el.innerHTML = `<table><thead><tr><th>#</th><th>Código</th><th>Denominación</th><th>Universidad</th><th>Nivel</th><th>Evaluación</th><th class="num">Esfuerzo</th></tr></thead><tbody>` +
      ti.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.codigo)}</td><td>${esc(t.denom)}</td><td>${esc(t.uni)}</td>
        <td>${sel(t.id, 'nivel', NIVELES, t.nivel)}</td><td>${sel(t.id, 'accion', ACCIONES, t.accion)}</td><td class="num">${fmt(t.effort)}</td></tr>`).join('') + '</tbody></table>';
    el.querySelectorAll('select').forEach(s => s.onchange = () => {
      const o = S.titOverrides[s.dataset.id] = S.titOverrides[s.dataset.id] || {};
      o[s.dataset.k] = s.value || undefined; save(); renderDatos();
    });
  }
}

// ---------------------------------------------------------------- render: esfuerzos
function renderEsfuerzos() {
  const W = S.weights;
  $('#wNivel').innerHTML = NIVELES.map(n => `<tr><th>${n}</th><td><input type="number" min="0" step="0.01" data-g="nivel" data-k="${n}" value="${W.nivel[n]}"></td></tr>`).join('');
  $('#wAccion').innerHTML = ACCIONES.map(a => `<tr><th>${ACC_CORTO[a]}</th><td><input type="number" min="0" step="0.01" data-g="accion" data-k="${a}" value="${W.accion[a]}"></td></tr>`).join('');
  document.querySelectorAll('#wNivel input, #wAccion input').forEach(i => i.onchange = () => {
    W[i.dataset.g][i.dataset.k] = Math.max(0, parseFloat(i.value) || 0); save(); renderEffortMatrix();
  });
  renderEffortMatrix();
  $('#pK').value = S.params.k; $('#pStudent').checked = !!S.params.student; $('#pAlpha').value = S.params.alpha;
  $('#pConflict').checked = !!S.params.conflict; $('#pOnlyAffine').checked = !!S.params.onlyAffine;
}
function renderEffortMatrix() {
  $('#effortTable').innerHTML = `<thead><tr><th></th>${ACCIONES.map(a => `<th class="num">${ACC_CORTO[a]}</th>`).join('')}</tr></thead><tbody>` +
    NIVELES.map(n => `<tr><th>${n}</th>${ACCIONES.map(a => `<td class="num">${fmt(effortOf(n, a))}</td>`).join('')}</tr>`).join('') + '</tbody>';
}

// ---------------------------------------------------------------- render: afinidad
function renderAfinidad() {
  const ev = getEvaluators();
  const areas = allAreas(ev);
  const kl = $('#kwList');
  if (!areas.length) kl.innerHTML = '<p class="muted">Carga la Excel de evaluadores para ver sus áreas.</p>';
  else {
    kl.innerHTML = areas.map(a => `<div class="kw"><div class="n">${esc(a.name)}<div class="c">${a.n} evaluador(es)</div></div>
      <textarea rows="2" data-area="${esc(a.name)}" placeholder="Palabras clave separadas por comas">${esc(keywordsFor(a.name))}</textarea></div>`).join('');
    kl.querySelectorAll('textarea').forEach(t => t.onchange = () => { S.keywords[t.dataset.area] = t.value; save(); renderAffSummary(); });
  }
  renderAffSummary();
}
function renderAffSummary() {
  const ev = getEvaluators().filter(e => !e.estudiante), ti = getTitles(); const el = $('#affSummary');
  if (!ev.length || !ti.length) { el.innerHTML = '<p class="muted" style="padding:8px">Carga ambas Excel.</p>'; return; }
  const aff = buildAffinity(ev, ti);
  const rows = ti.map(t => {
    const list = ev.map(e => ({ e, h: aff[t.id][e.id] })).filter(x => x.h > 0).sort((a, b) => b.h - a.h);
    return { t, list };
  }).sort((a, b) => a.list.length - b.list.length);
  el.innerHTML = `<table><thead><tr><th>Título</th><th class="num">Afines</th><th>Evaluadores afines (por grado de afinidad)</th></tr></thead><tbody>` +
    rows.map(({ t, list }) => `<tr><td>${esc(t.denom)}</td><td class="num ${list.length >= K_() ? '' : 'bad'}">${list.length}</td>
      <td>${list.slice(0, 8).map(x => `<span class="tag aff-${affLevel(x.h)}">${esc(x.e.nombre)}</span>`).join(' ')}${list.length > 8 ? ' …' : ''}</td></tr>`).join('') + '</tbody></table>';
}

// ---------------------------------------------------------------- render: asignación
let selEval = null;
function loadRows(list, mx) {
  return list.map(p => {
    const cls = p.target && p.load > p.target * 1.2 ? 'over' : (p.target && p.load < p.target * 0.8 ? 'under' : '');
    return `<div class="loadrow ${selEval === p.e.id ? 'sel' : ''}" data-id="${p.e.id}" title="${esc(p.e.areas.join('; '))}">
      <span class="name">${esc(p.e.nombre)} <span class="muted">(${p.n})</span></span>
      <span class="track"><span class="fill ${cls}" style="width:${100 * p.load / mx}%"></span><span class="target" style="left:${100 * p.target / mx}%"></span></span>
      <span class="val">${fmt(p.load)}</span></div>`;
  }).join('');
}
function renderAsignacion() {
  const st = stats();
  const { evals, titles, aff, per, N } = st;
  $('#runInfo').textContent = S.lastRun ? 'Último cálculo: ' + new Date(S.lastRun).toLocaleString('es-ES') : '';
  const assigned = st.slots - st.empty;
  $('#kpis').innerHTML = !titles.length ? '' : [
    [titles.length, 'títulos'], [fmt(st.D), 'esfuerzo por título (suma)'],
    [assigned + '/' + st.slots, 'plazas de académicos asignadas'],
    ...(S.params.student ? [[(titles.length - st.emptyStu) + '/' + titles.length, 'con vocal estudiante']] : []),
    [assigned ? Math.round(100 * st.lv[2] / assigned) + ' %' : '—', 'afinidad alta'],
    [assigned ? Math.round(100 * st.lv[1] / assigned) + ' %' : '—', 'afinidad media'],
    [st.lv[0], 'sin afinidad'], [fmt(st.dev), 'desv. típica de carga (académicos)'],
    [st.conflicts, 'conflictos de universidad']
  ].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');

  // cargas
  const all = Object.values(per);
  const acad = all.filter(p => !p.e.estudiante).sort((a, b) => b.load - a.load);
  const stu = all.filter(p => p.e.estudiante).sort((a, b) => b.load - a.load);
  const mx = Math.max(1e-9, ...acad.map(p => Math.max(p.load, p.target)));
  const mxs = Math.max(1e-9, ...stu.map(p => Math.max(p.load, p.target)));
  $('#loads').innerHTML = !all.length ? '<p class="muted">Sin evaluadores.</p>' :
    `<h3>Académicos</h3>${loadRows(acad, mx)}` +
    (stu.length ? `<h3>Vocales estudiantes</h3>${loadRows(stu, mxs)}` : '') +
    '<p class="muted">La raya vertical marca la carga objetivo. Pulsa un evaluador para filtrar sus títulos.</p>';
  $('#loads').querySelectorAll('.loadrow').forEach(r => r.onclick = () => { selEval = selEval === r.dataset.id ? null : r.dataset.id; renderAsignacion(); });

  // tabla
  if (!titles.length || !evals.length) { $('#asgTable').innerHTML = '<p class="muted" style="padding:8px">Carga ambas Excel en la pestaña Datos.</p>'; return; }
  const f = norm($('#filterAsg').value);
  const E = {}; evals.forEach(e => E[e.id] = e);
  const rows = titles.filter(t => {
    const a = S.asg[t.id] || [];
    if (selEval && !a.includes(selEval)) return false;
    if (!f) return true;
    return norm([t.denom, t.codigo, t.uni, t.nivel, t.accion, ...a.map(j => E[j] ? E[j].nombre : '')].join(' ')).includes(f);
  });
  const opts = (t, s, cur) => {
    const stuSlot = isStudentSlot(s);
    const o = evals.filter(e => e.estudiante === stuSlot).map(e => ({ e, h: aff[t.id][e.id], c: uniConflict(t, e) }))
      .sort((a, b) => (stuSlot ? 0 : b.h - a.h) || ((per[a.e.id].load - per[a.e.id].target) - (per[b.e.id].load - per[b.e.id].target)));
    return `<option value="">— sin asignar —</option>` + o.map(x =>
      `<option value="${x.e.id}" ${x.e.id === cur ? 'selected' : ''}>${stuSlot ? '' : ['○', '◐', '●'][affLevel(x.h)] + ' '}${esc(x.e.nombre)} · ${fmt(per[x.e.id].load)}${x.c ? ' · ⚠ misma univ.' : ''}</option>`).join('');
  };
  $('#asgTable').innerHTML = `<table><thead><tr><th>Título</th><th>Nivel · evaluación</th><th class="num">Esf.</th>${Array.from({ length: N }, (_, s) => `<th>${slotName(s)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(t => {
      const a = S.asg[t.id] || [], lk = S.locks[t.id] || [];
      return `<tr><td>${esc(t.denom)}${t.uni ? `<br><span class="muted">${esc(t.uni)}</span>` : ''}</td>
        <td>${esc(t.nivel || '?')} · ${esc(ACC_CORTO[t.accion] || '?')}</td><td class="num">${fmt(t.effort)}</td>` +
        Array.from({ length: N }, (_, s) => {
          const j = a[s]; const h = j && aff[t.id][j] != null ? aff[t.id][j] : 0;
          const tag = !j ? '<span class="tag aff-0">sin asignar</span>' : isStudentSlot(s) ? '' : `<span class="tag aff-${affLevel(h)}">${AFF_TXT[affLevel(h)]}</span>`;
          return `<td><select data-t="${t.id}" data-s="${s}">${opts(t, s, j)}</select>
            <span class="lock" data-t="${t.id}" data-s="${s}" title="${lk[s] ? 'Fijado: pulsa para liberar' : 'Pulsa para fijar'}">${lk[s] ? '🔒' : '🔓'}</span>
            <br>${tag}${j && E[j] && uniConflict(t, E[j]) ? ' <span class="tag aff-0">misma universidad</span>' : ''}</td>`;
        }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  $('#asgTable').querySelectorAll('select').forEach(sel => sel.onchange = () => {
    const t = sel.dataset.t, s = +sel.dataset.s;
    const a = S.asg[t] = S.asg[t] || []; const lk = S.locks[t] = S.locks[t] || [];
    if (sel.value && a.some((x, i) => i !== s && x === sel.value)) { alert('Ese evaluador ya está asignado a este título.'); renderAsignacion(); return; }
    a[s] = sel.value || null; lk[s] = !!sel.value; save(); renderAsignacion();
  });
  $('#asgTable').querySelectorAll('.lock').forEach(l => l.onclick = () => {
    const lk = S.locks[l.dataset.t] = S.locks[l.dataset.t] || []; lk[+l.dataset.s] = !lk[+l.dataset.s]; save(); renderAsignacion();
  });
}

// ---------------------------------------------------------------- exportación
function exportXlsx() {
  const st = stats(); const { titles, aff, per, N } = st;
  if (!titles.length) return alert('No hay datos.');
  const E = {}; st.evals.forEach(e => E[e.id] = e);
  const h1 = ['Código', 'Denominación', 'Universidad', 'Nivel', 'Evaluación', 'Esfuerzo'];
  for (let s = 0; s < N; s++) {
    if (isStudentSlot(s)) h1.push('Vocal estudiante');
    else h1.push(slotName(s), 'Área ' + (s + 1), 'Afinidad ' + (s + 1));
  }
  const r1 = titles.map(t => {
    const row = [t.codigo, t.denom, t.uni, t.nivel, ACC_CORTO[t.accion] || '', t.effort]; const a = S.asg[t.id] || [];
    for (let s = 0; s < N; s++) {
      const e = E[a[s]];
      if (isStudentSlot(s)) row.push(e ? e.nombre : '');
      else row.push(e ? e.nombre : '', e ? e.areas.join('; ') : '', e ? AFF_TXT[affLevel(aff[t.id][e.id])] : '');
    }
    return row;
  });
  const sorted = Object.values(per).sort((a, b) => (a.e.estudiante - b.e.estudiante) || a.e.nombre.localeCompare(b.e.nombre, 'es'));
  const r2 = sorted.map(p => [p.e.nombre, p.e.estudiante ? 'Estudiante' : 'Académico', p.e.areas.join('; '), p.e.uni, p.e.email, p.n,
    Math.round(p.load * 1000) / 1000, Math.round(p.target * 1000) / 1000, Math.round((p.load - p.target) * 1000) / 1000]);
  const r3 = [];
  sorted.forEach(p => p.items.forEach(t => r3.push([p.e.nombre, p.e.estudiante ? 'Estudiante' : 'Académico', p.e.email, t.codigo, t.denom, t.uni, t.nivel, ACC_CORTO[t.accion] || '', t.effort,
    p.e.estudiante ? '' : AFF_TXT[affLevel(aff[t.id][p.e.id])]])));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([h1, ...r1]), 'Asignaciones');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Evaluador', 'Perfil', 'Área(s)', 'Universidad', 'Email', 'Nº títulos', 'Carga', 'Carga objetivo', 'Desviación'], ...r2]), 'Carga por evaluador');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Evaluador', 'Perfil', 'Email', 'Código', 'Denominación', 'Universidad', 'Nivel', 'Evaluación', 'Esfuerzo', 'Afinidad'], ...r3]), 'Detalle por evaluador');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Pesos', ''], ...NIVELES.map(n => [n, S.weights.nivel[n]]), ...ACCIONES.map(a => [ACC_CORTO[a], S.weights.accion[a]]), [],
    ['Esfuerzo (nivel × tipo)', ...ACCIONES.map(a => ACC_CORTO[a])], ...NIVELES.map(n => [n, ...ACCIONES.map(a => effortOf(n, a))])]), 'Esfuerzos');
  XLSX.writeFile(wb, 'asignaciones_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
function downloadTemplate(kind) {
  const wb = XLSX.utils.book_new();
  const data = kind === 'eval' ? [
    ['Nombre', 'Apellidos', 'Perfil', 'Área de conocimiento', 'Universidad', 'Capacidad', 'Email'],
    ['Ana', 'García López', 'Académico', 'Ingeniería Mecánica', 'Universidad de Ejemplo', 1, 'ana@ejemplo.es'],
    ['Luis', 'Pérez Martín', 'Académico', 'Teoría de la Señal y Comunicaciones', 'Universidad Modelo', 1, 'luis@ejemplo.es'],
    ['Marta', 'Ruiz Sanz', 'Académico', 'Ingeniería Eléctrica; Tecnología Electrónica', 'Universidad Muestra', 0.5, 'marta@ejemplo.es'],
    ['Pablo', 'Gil Ortega', 'Estudiante', '', 'Universidad Muestra', 1, 'pablo@ejemplo.es']
  ] : [
    ['RUCT', 'Denominación', 'Nivel', 'Tipo de evaluación', 'Universidad'],
    ['2500001', 'Grado en Ingeniería Mecánica', 'Grado', 'Verifica', 'Universidad Modelo'],
    ['4300001', 'Máster Universitario en Ingeniería de Telecomunicación', 'Máster', 'Modifica', 'Universidad de Ejemplo'],
    ['2500002', 'Grado en Ingeniería Eléctrica', 'Grado', 'Seguimiento', 'Universidad Muestra'],
    ['2500003', 'Grado en Ingeniería Química', 'Grado', 'AleVerifica', 'Universidad Modelo'],
    ['4300002', 'Máster Universitario en Ingeniería Industrial', 'Máster', 'AleModifica', 'Universidad de Ejemplo']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), kind === 'eval' ? 'Evaluadores' : 'Títulos');
  XLSX.writeFile(wb, kind === 'eval' ? 'plantilla_evaluadores.xlsx' : 'plantilla_titulos.xlsx');
}

// ---------------------------------------------------------------- eventos
function renderAll() { renderDatos(); renderEsfuerzos(); renderAfinidad(); renderAsignacion(); }

function init() {
  load();
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab));
    renderAll();
  });
  $('#fileEval').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { S.evalRaw = await readFile(f); S.mapEval = detectMap(S.evalRaw.headers, EVAL_FIELDS); S.evalOverrides = {}; S.asg = {}; S.locks = {}; save(); renderAll(); }
    catch (e) { alert('No se pudo leer el fichero: ' + e.message); }
  };
  $('#fileTit').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { S.titRaw = await readFile(f); S.mapTit = detectMap(S.titRaw.headers, TIT_FIELDS); S.titOverrides = {}; S.asg = {}; S.locks = {}; save(); renderAll(); }
    catch (e) { alert('No se pudo leer el fichero: ' + e.message); }
  };
  document.querySelectorAll('input[name=prev]').forEach(r => r.onchange = renderPreview);
  $('#tplEval').onclick = () => downloadTemplate('eval');
  $('#tplTit').onclick = () => downloadTemplate('tit');
  $('#btnEffortDefault').onclick = () => { S.weights = JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)); save(); renderEsfuerzos(); };
  $('#pK').onchange = (e) => { S.params.k = Math.min(5, Math.max(1, parseInt(e.target.value) || 1)); S.asg = {}; S.locks = {}; save(); };
  $('#pStudent').onchange = (e) => { S.params.student = e.target.checked; S.asg = {}; S.locks = {}; save(); renderDatos(); };
  $('#pAlpha').onchange = (e) => { S.params.alpha = +e.target.value; save(); };
  $('#pConflict').onchange = (e) => { S.params.conflict = e.target.checked; save(); };
  $('#pOnlyAffine').onchange = (e) => { S.params.onlyAffine = e.target.checked; save(); };
  $('#btnRun').onclick = () => {
    if (!getEvaluators().length || !getTitles().length) return alert('Carga primero las dos Excel.');
    computeAssignment(); renderAsignacion();
  };
  $('#btnClearLocks').onclick = () => { S.locks = {}; save(); renderAsignacion(); };
  $('#btnExportXlsx').onclick = exportXlsx;
  $('#filterAsg').oninput = renderAsignacion;
  $('#btnExportSession').onclick = () => {
    const b = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = 'sesion_asignaciones_' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  };
  $('#fileSession').onchange = (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    f.text().then(t => { S = Object.assign(freshState(), JSON.parse(t)); save(); renderAll(); })
      .catch(e => alert('Sesión no válida: ' + e.message));
  };
  $('#btnReset').onclick = () => { if (confirm('¿Borrar todos los datos de esta sesión?')) { S = freshState(); save(); location.reload(); } };
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
})();
