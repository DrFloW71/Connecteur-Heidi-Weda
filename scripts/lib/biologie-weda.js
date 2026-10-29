// Module embarqué dans les userscripts par scripts/sync-biologie.cjs.
function createWedaBiologyEnhancements(env) {
  'use strict';
  env = env || {};
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const fold = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const number = value => {
    const match = text(value).replace(/\s/g, '').match(/^([<>≤≥]?)(-?\d+(?:[,.]\d+)?)$/);
    return match ? {operator: match[1], value: Number(match[2].replace(',', '.'))} : null;
  };
  const decimal = (value, digits = 2) => Number(value.toFixed(digits)).toString().replace('.', ',');
  const unit = value => fold(value).replace(/μ/g, 'µ').replace(/²/g, '2').replace(/³/g, '3').replace(/⁹/g, '9').replace(/\s/g, '');
  const doc = env.document, win = env.window;
  const log = (event, data = {}) => env.log?.('weda:biology-' + event, data);
  const special = new Set(['asat', 'alat', 'ggt', 'bili_tot', 'bili_conj']);
  const required = new Set(['crp', 'tsh', 'ldl', 'nonhdl', 'hg', 'tropo', 'pct', 'bnp', 'ntbnp', 'lipase', 'hcg', 'inr', 'dfg']);
  const tracked = new Set(['ldl', 'hg', 'gly', 'crp', 'tsh', 'bili_tot', 'bili_conj', 'asat', 'alat', 'ggt', 'dfg', 'hb', 'plaq', 'bnp', 'ntbnp']);
  const narrative = value => /anapath|anatom[oie -]*patholog|histolog|histopatholog/i.test(value || '');

  function marker(label) {
    const key = fold(label).replace(/[.:]/g, '');
    const patterns = [
      ['nonhdl', 'non-HDL', /\bnon\s*[- ]?\s*hdl\b/],
      ['ldl', 'LDL', /\bldl(?:c)?\b|l\s*d\s*l/],
      ['hdl', 'HDL', /\bhdl\b|h\s*d\s*l/],
      ['hg', 'HbA1c', /\bhb\s*a\s*1\s*c\b|hemoglobine.*glyquee|^hg$/],
      ['gly', 'Gly', /\b(?:gly|glycemie|glucose)\b/],
      ['crp', 'CRP', /\bcrp\b|proteine c reactive/],
      ['tsh', 'TSH', /^(?:tsh(?:\s*us)?|thyreostimuline)(?:\b|$)/],
      ['ntbnp', 'NT-proBNP', /nt\s*[- ]?\s*pro\s*[- ]?\s*bnp/],
      ['bnp', 'BNP', /\bbnp\b/],
      ['bili_conj', 'Bili. conj.', /bili.*(?:conj|direct)/],
      ['bili_tot', 'Bili. tot.', /bili.*tot/],
      ['asat', 'ASAT', /^(?:asat|ast|tgo)\b/],
      ['alat', 'ALAT', /^(?:alat|alt|tgp)\b/],
      ['ggt', 'GGT', /^(?:ggt|gamma\s*[- ]?\s*gt|gamma glutamyl)/],
      ['dfg', 'DFG', /\bdfg\b|\begfr\b|ckd\s*[- ]?\s*epi|\bmdrd\b|debit de filtration/],
      ['hb', 'Hb', /^(?:hb|hemoglobine)\b/],
      ['plaq', 'Plaq', /^(?:plaq|plaquettes?|thrombocytes?)\b/],
      ['tg', 'TG', /^(?:tg|triglycerides?)\b/],
      ['tropo', 'TROPO', /^(?:tropo|troponine)/],
      ['pct', 'PCT', /^(?:pct|procalcitonine)\b/],
      ['lipase', 'LIPASE', /^lipase\b/],
      ['hcg', 'HCG', /(?:^|\b)(?:hcg|beta[- ]?hcg|β[- ]?hcg)\b/],
      ['inr', 'INR', /^inr\b/],
      ['pnn', 'PNN', /neutroph|^pnn\b/],
      ['mono', 'Mono', /monocyt|^mono\b/],
      ['eos', 'Eos', /eosinoph|^eos\b/],
      ['baso', 'Baso', /basoph|^baso\b/],
      ['lympho', 'Lympho', /lymphocyt|^lympho\b/],
      ['leuco', 'Leuco', /^(?:leucocytes?|leuco)\b/],
      ['vgm', 'VGM', /^vgm\b/],
      ['ferr', 'ferr', /^(?:ferritine|ferr)\b/],
      ['k', 'K+', /^(?:k\+|potassium|kaliemie)/],
      ['na', 'Na', /^(?:na|sodium|natremie)\b/],
    ];
    if (/anticorps|recepteur|^anti[- ]/.test(key)) return null;
    for (const [id, name, pattern] of patterns) {
      if (!pattern.test(key)) continue;
      if (id === 'gly' && /urinaire|urines?|lcr|glycosurie|liquide/.test(key)) return null;
      return {id, name, kind: id === 'dfg' ? /ckd/.test(key) ? 'ckd' : /mdrd/.test(key) ? 'mdrd' : '' : ''};
    }
    return null;
  }

  function conversion(id, sourceUnit) {
    const key = unit(sourceUnit);
    if (['ldl', 'hdl', 'nonhdl'].includes(id)) {
      if (key === 'mmol/l') return {factor: 0.3867, unit: 'g/L'};
      if (key === 'mg/dl') return {factor: 0.01, unit: 'g/L'};
      if (key === 'g/l') return {factor: 1, unit: 'g/L'};
    }
    if (id === 'gly') {
      const factor = {'mmol/l': 0.18, 'mg/dl': 0.01, 'mg/l': 0.001, 'g/l': 1}[key];
      if (factor !== undefined) return {factor, unit: 'g/L'};
    }
    if (id === 'hb' && ['g/l', 'g/dl'].includes(key)) return {factor: key === 'g/l' ? 0.1 : 1, unit: 'g/dL'};
    if (id === 'hg' && ['%', 'mmol/mol'].includes(key)) return {factor: key === '%' ? 1 : 0.09148, offset: key === '%' ? 0 : 2.152, unit: '%'};
    return null;
  }

  function normalizeRow(original) {
    const cells = original.slice(), item = marker(cells[0]);
    const convert = item && conversion(item.id, cells[2]);
    if (!convert || !number(cells[1])) return cells;
    if ([cells[3], cells[4]].some(value => text(value) && !number(value))) return cells;
    for (const index of [1, 3, 4]) {
      const value = number(cells[index]);
      if (value) cells[index] = value.operator + decimal(value.value * convert.factor + (convert.offset || 0), item.id === 'hg' ? 1 : 2);
    }
    cells[2] = convert.unit;
    return cells;
  }

  function differential(label) {
    const item = marker(label);
    return item && ['pnn', 'mono', 'eos', 'baso', 'lympho'].includes(item.id) ? item : null;
  }
  function absolute(cells) {
    return Boolean(differential(cells[0]) && number(cells[1]) &&
      /^(?:g\/l|10\^?9\/l|(?:cellules?\/)?mm3|\/mm3|\/µl)$/.test(unit(cells[2])));
  }
  function normalizeRows(rows) {
    let previous = null;
    return rows.map(original => {
      const cells = normalizeRow(original);
      if (/^soit\s*:?\s*$/i.test(cells[0])) {
        if (previous && absolute([previous.name, ...cells.slice(1)])) cells[0] = previous.name;
        previous = null;
      } else previous = differential(cells[0]);
      return cells;
    });
  }
  function reportRows(report) {
    const lines = String(report || '').split(/\n+/);
    if (/^Libellé\tValeur\t/.test(lines[0])) return normalizeRows(lines.slice(1).map(line => line.split('\t').map(text)));
    return lines.flatMap(line => {
      const match = line.match(/^\s*(CRP|Protéine C réactive|TSH(?:\s*us)?|thyréostimuline)\s*[:=|]?\s*([<>≤≥]?\s*\d+(?:[,.]\d+)?)\s*(mg\/L|mUI\/L|[µu]UI\/mL)?(?:\s*(?:\(|\[|normes?\s*:)\s*(\d+(?:[,.]\d+)?)\s*[-–;à]\s*(\d+(?:[,.]\d+)?))?/i);
      return match ? [[match[1], match[2], match[3] || '', match[4] || '', match[5] || '', '']] : [];
    });
  }
  function status(cells) {
    if (['HAUT', 'BAS', 'NORMAL', 'À RELIRE', 'À VÉRIFIER'].includes(cells[5])) return cells[5];
    return env.status?.(cells[1], cells[3], cells[4]) || 'NORMES ABSENTES';
  }
  const symbol = cells => ({NORMAL: 'N', HAUT: '↑', BAS: '↓'})[status(cells)] || '?';

  function splitTitle(value) {
    const parts = [], input = text(value);
    let start = 0, depth = 0;
    for (let i = 0; i < input.length; i++) {
      if (input[i] === '[' || input[i] === '(') depth++;
      if (input[i] === ']' || input[i] === ')') depth = Math.max(0, depth - 1);
      if (depth) continue;
      const join = input.slice(i, i + 4).toLowerCase() === ' et ' && marker(input.slice(i + 4).split(/\s+[N↑↓?]?\s*[<>≤≥]?\d/)[0]);
      if ((input[i] === ',' && !(/\d/.test(input[i - 1] || '') && /\d/.test(input[i + 1] || ''))) || /[;|]/.test(input[i]) || join) {
        if (text(input.slice(start, i))) parts.push(text(input.slice(start, i)));
        if (join) i += 3;
        start = i + 1;
      }
    }
    if (text(input.slice(start))) parts.push(text(input.slice(start)));
    return parts;
  }
  function segmentMarker(segment) {
    const match = text(segment).replace(/^(non-HDL)(?=\d)/i, '$1 ').match(/^(.+?)\s+(?:[N↑↓?]{1,2}\s*)?[<>≤≥]?\s*-?\d/);
    return match ? marker(match[1]) : null;
  }
  function selectRow(rows, item) {
    let candidates = rows.filter(cells => marker(cells[0])?.id === item.id && number(cells[1]) &&
      (item.id !== 'pct' || unit(cells[2]) !== '%') && (!differential(cells[0]) || absolute(cells)));
    if (item.id === 'dfg' && candidates.some(cells => marker(cells[0]).kind === 'ckd')) candidates = candidates.filter(cells => marker(cells[0]).kind === 'ckd');
    const variants = new Set(candidates.map(cells => {
      const value = number(cells[1]);
      return value.operator + value.value + '|' + unit(cells[2]) + '|' + status(cells);
    }));
    if (variants.size > 1) throw new Error('Résultats discordants pour ' + item.name + ' : vérification du bilan nécessaire.');
    return candidates[0] || null;
  }
  function formatRow(cells, item) {
    const suffix = item.id === 'dfg' ? '' : text(cells[2]);
    const value = number(cells[1]), upper = number(cells[4]);
    const multiple = special.has(item.id) && status(cells) === 'HAUT' && value && !value.operator &&
      upper && !upper.operator && upper.value > 0 ? ' [' + decimal(value.value / upper.value, 1) + 'N]' : '';
    return text(item.name + ' ' + symbol(cells) + ' ' + cells[1] + (suffix ? ' ' + suffix : '') + multiple);
  }
  function enrichTitle(title, report, history = []) {
    const original = text(title);
    if (!original || narrative(report) || /^(?:Anapath|Conclusion labo)\s*:/i.test(original)) return original;
    const rows = reportRows(report);
    if (!rows.length) return original;
    const prefix = original.match(/^(IMPORTANT|URGENCE)\s*:\s*/i)?.[0] || '';
    let parts = splitTitle(original.slice(prefix.length));
    const seen = new Set(), absoluteTypes = new Set(rows.filter(absolute).map(cells => marker(cells[0]).id));
    parts = parts.flatMap(part => {
      const item = segmentMarker(part);
      if (!item) return [part];
      if (seen.has(item.id)) return [];
      const cells = selectRow(rows, item);
      if (!cells) return /^Libellé\tValeur\t/.test(report) ? [] : [part];
      seen.add(item.id);
      if (absoluteTypes.has(item.id) && status(cells) === 'NORMAL') return [];
      return [formatRow(cells, marker(cells[0]))];
    });
    const wanted = new Map();
    rows.forEach(cells => {
      const item = marker(cells[0]);
      if (item && (required.has(item.id) || (absolute(cells) && ['HAUT', 'BAS'].includes(status(cells))))) wanted.set(item.id, item);
    });
    for (const item of wanted.values()) {
      if (seen.has(item.id)) continue;
      const cells = selectRow(rows, item);
      if (cells) { parts.push(formatRow(cells, marker(cells[0]))); seen.add(item.id); }
    }
    if (rows.some(cells => /^soit\b/i.test(cells[0]) && ['HAUT', 'BAS'].includes(status(cells)))) throw new Error('Formule leucocytaire non rattachée : vérification du bilan nécessaire.');
    if (parts.some(part => /[↑↓]/.test(part))) parts = parts.filter(part => !/^Bilan RAS\.?$/i.test(part));
    parts = parts.map(part => {
      const item = segmentMarker(part), previous = item && history.find(entry => entry.id === item.id);
      return previous ? part + ' [' + previous.display + ' le ' + previous.date + ']' : part;
    });
    const output = prefix + parts.join(', ');
    if (output.length > 350) throw new Error('Synthèse enrichie trop longue : aucune troncature automatique ; vérification nécessaire.');
    return output;
  }
  function dateMs(value) {
    const match = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return NaN;
    const [day, month, year] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : NaN;
  }
  function compareHistory(targets, entries, currentDate) {
    const current = dateMs(currentDate);
    if (!Number.isFinite(current)) return [];
    return targets.flatMap(cells => {
      const item = marker(cells[0]);
      if (!item || !tracked.has(item.id) || !['HAUT', 'BAS'].includes(status(cells))) return [];
      const candidates = entries.filter(entry => entry.id === item.id && (entry.kind || '') === item.kind &&
        Number.isFinite(dateMs(entry.date)) && dateMs(entry.date) < current).sort((a, b) => dateMs(b.date) - dateMs(a.date));
      if (!candidates.length) return [];
      const normalized = candidates.filter(entry => entry.date === candidates[0].date).map(entry => normalizeRow([cells[0], entry.value, entry.unit, '', '', '']));
      if (new Set(normalized.map(row => text(row[1]) + '|' + unit(row[2]))).size !== 1) return [];
      const previous = normalized[0];
      if (!number(previous[1]) || !unit(previous[2]) || unit(previous[2]) !== unit(cells[2])) return [];
      return [{id: item.id, date: candidates[0].date, display: text(previous[1] + ' ' + previous[2])}];
    });
  }
  function historyEntries(grid) {
    const entries = [];
    let current = null;
    for (const row of grid.querySelectorAll('tr')) {
      const cells = Array.from(row.cells || []).map(cell => text(cell.textContent));
      if (cells.length < 2) continue;
      if (cells[0]) current = marker(cells[0].split(':')[0]);
      if (!current) continue;
      for (const match of cells[cells.length - 1].matchAll(/(\d{2}\/\d{2}\/\d{4})\s*:\s*(.*?)(?=\d{2}\/\d{2}\/\d{4}\s*:|$)/g)) {
        const result = match[2].trim().match(/^([<>≤≥]?\s*-?\d+(?:[,.]\d+)?)(?:\s+|(?=[A-Za-zµμ%/]))(.+)$/);
        if (result) entries.push({...current, date: match[1], value: text(result[1]), unit: text(result[2])});
      }
    }
    return entries;
  }
  const panelSelector = '[id$="PanelHistoriqueSuivi"]', gridSelector = '[id$="HistoriqueSuiviGrid"]';
  let historyRevision = 0;
  const visible = element => Boolean(element && !element.hidden && win.getComputedStyle(element).display !== 'none' && win.getComputedStyle(element).visibility !== 'hidden');
  const selected = () => env.getRows().find(row => row.row.classList.contains('grid-selecteditem'));
  function assertContext(row, contentKey) {
    const current = selected();
    if (!current || current.key !== row.key || current.stableKey !== row.stableKey || !env.matches(current) || env.contentKey() !== contentKey) {
      throw new Error('La sélection du bilan a changé : opération interrompue.');
    }
  }
  async function collectHistory(report, row, contentKey) {
    const targets = reportRows(report).filter(cells => tracked.has(marker(cells[0])?.id) && ['HAUT', 'BAS'].includes(status(cells)));
    if (!targets.length || !Number.isFinite(dateMs(row.date || row.cells[0]))) return [];
    assertContext(row, contentKey);
    if (visible(doc.querySelector(panelSelector))) { log('history-skipped', {reason: 'historique déjà ouvert'}); return []; }
    const buttons = Array.from(doc.querySelectorAll('#ContentPlaceHolder1_PatientsGrid [id*="ButtonHistoriqueResultat_"]')).filter(button => !button.disabled);
    if (buttons.length !== 1) { log('history-skipped', {reason: 'bouton historique absent ou ambigu'}); return []; }
    const before = doc.querySelector(gridSelector), beforeText = before?.textContent || '', revision = historyRevision;
    let mutated = false;
    const observer = new win.MutationObserver(records => {
      if (records.some(record => {
        const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        return node?.closest(panelSelector + ',' + gridSelector) || Array.from(record.addedNodes).some(added =>
          added.matches?.(panelSelector + ',' + gridSelector) || added.querySelector?.(gridSelector));
      })) mutated = true;
    });
    observer.observe(doc.body, {subtree: true, childList: true, characterData: true});
    try {
      buttons[0].click();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        assertContext(row, contentKey);
        const state = env.getState();
        if (!state.running || state.phase !== 'clickedRow' || state.currentStableKey !== row.stableKey) throw new Error('Analyse arrêtée ou remplacée.');
        if (revision !== historyRevision) throw new Error('Historique repris manuellement.');
        const grid = doc.querySelector(gridSelector);
        if (visible(doc.querySelector(panelSelector)) && grid && mutated &&
            (grid !== before || grid.textContent !== beforeText) && grid.querySelectorAll('tr').length > 1) {
          const comparisons = compareHistory(targets, historyEntries(grid), row.date || row.cells[0]);
          assertContext(row, contentKey);
          log('history-collected', {comparisons: comparisons.length});
          return comparisons;
        }
        await new Promise(resolve => win.setTimeout(resolve, 200));
      }
      log('history-skipped', {reason: 'historique frais non confirmé'});
      return [];
    } finally {
      observer.disconnect();
      if (revision === historyRevision) {
        let canClose = true;
        try { assertContext(row, contentKey); } catch (_error) { canClose = false; }
        const panel = canClose ? doc.querySelector(panelSelector) : null;
        const close = panel && Array.from(panel.querySelectorAll('button,input,a,img')).filter(visible).filter(element =>
          /^(?:fermer|close|annuler|×|x)$/i.test(text(element.textContent || element.value || element.title || element.alt)));
        if (close?.length === 1) close[0].click();
      }
    }
  }
  function summaryGroup(value) {
    if (/^CA\s*125\b/i.test(value)) return 'Gynécologie';
    if (/^CA\s*15\s*[- ]\s*3\b/i.test(value)) return 'Sénologie';
    const id = segmentMarker(value)?.id;
    if (['ldl', 'nonhdl', 'hdl', 'tg', 'bnp', 'ntbnp', 'tropo'].includes(id)) return 'Cardio-vasculaire';
    if (['asat', 'alat', 'ggt', 'bili_tot', 'bili_conj', 'lipase'].includes(id) || /^(?:PAL|Hémoccult|AFP|CA\s*19\s*[- ]\s*9)\b/i.test(value)) return 'Hépato-gastro';
    if (['dfg', 'k', 'na'].includes(id) || /^(?:RAC|ECBU|PSA|Ca|Mg)\b/i.test(value)) return 'Urologie / néphrologie';
    if (['hb', 'plaq', 'leuco', 'pnn', 'mono', 'eos', 'baso', 'lympho', 'vgm', 'ferr', 'crp', 'pct', 'inr'].includes(id)) return 'Hématologie';
    if (['hg', 'gly', 'tsh', 'hcg'].includes(id) || /^(?:T[34]L|B12|folates|vitamine)\b/i.test(value)) return 'Endocrinologie';
    if (/^(?:IST|VIH|VHB|VHC)\b/i.test(value)) return 'Infectiologie';
    return 'Autres résultats';
  }
  function summaryModel(value) {
    const original = text(value), prefix = original.match(/^(IMPORTANT|URGENCE)\s*:\s*/i)?.[0] || '', body = original.slice(prefix.length);
    const groups = new Map();
    for (const segment of /^(?:Anapath|Conclusion labo)\s*:/i.test(body) ? [body] : splitTitle(body)) {
      const history = [];
      const current = text(segment.replace(/\[([^\]]+)\]/g, (whole, inner) => {
        if (!/\d{2}\/\d{2}\/\d{4}/.test(inner)) return whole;
        history.push(inner); return '';
      }));
      const group = summaryGroup(current);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({current, history, tone: /[↑↓]/.test(current) ? 'abnormal' : /\sN\s/.test(current) ? 'normal' : 'unknown'});
    }
    return {original, prefix, groups: Array.from(groups, ([name, items]) => ({name, items}))};
  }
  function historyDelta(current, previous) {
    const match = current.match(/\s(?:N|[↑↓?]{1,2})\s+([<>≤≥]?-?\d+(?:[,.]\d+)?)\s+([^\[\]]+?)(?:\s+\[|$)/);
    const old = previous.match(/^([<>≤≥]?-?\d+(?:[,.]\d+)?)\s+(.+?)\s+le\s+\d{2}\/\d{2}\/\d{4}$/);
    if (!match || !old || unit(match[2]) !== unit(old[2])) return '';
    const a = number(match[1]), b = number(old[1]);
    if (!a || !b || a.operator || b.operator) return '';
    const delta = a.value - b.value;
    return 'Variation : ' + (delta > 0 ? '+' : '') + decimal(delta) + ' ' + text(match[2]);
  }
  function card(title, nativeTable = null) {
    const model = summaryModel(title), section = doc.createElement('section');
    section.className = 'wbe-summary'; section.setAttribute('aria-label', 'Synthèse biologique et antériorités');
    const heading = doc.createElement('div');
    heading.className = 'wbe-heading'; heading.textContent = model.prefix || 'Synthèse biologique'; section.append(heading);
    for (const group of model.groups) {
      const row = doc.createElement('div'), name = doc.createElement('strong');
      row.className = 'wbe-group'; row.dataset.category = group.name; name.textContent = group.name; row.append(name);
      for (const item of group.items) {
        const result = doc.createElement('div'), current = doc.createElement('span');
        result.className = 'wbe-result'; result.dataset.tone = item.tone; current.textContent = item.current; result.append(current);
        for (const previous of item.history) {
          const old = doc.createElement('small');
          old.textContent = 'Précédent : ' + previous; result.append(old);
          const delta = historyDelta(item.current, previous);
          if (delta) { const badge = doc.createElement('small'); badge.textContent = delta; result.append(badge); }
        }
        row.append(result);
      }
      section.append(row);
    }
    const details = doc.createElement('details'), summary = doc.createElement('summary'), full = doc.createElement('div');
    summary.textContent = 'Titre complet'; full.textContent = model.original; details.append(summary, full); section.append(details);
    if (nativeTable) {
      const button = doc.createElement('button');
      button.type = 'button'; button.textContent = 'Masquer le tableau WEDA'; button.setAttribute('aria-expanded', 'true');
      button.addEventListener('click', () => {
        const hidden = nativeTable.classList.toggle('wbe-native-hidden');
        button.textContent = hidden ? 'Afficher le tableau WEDA' : 'Masquer le tableau WEDA';
        button.setAttribute('aria-expanded', String(!hidden));
      });
      section.append(button);
    }
    return section;
  }
  function setupStyle() {
    if (doc.getElementById('wbe-style')) return;
    const style = doc.createElement('style'); style.id = 'wbe-style';
    style.textContent = '.wbe-summary{font:13px Arial,sans-serif;margin:10px 0;padding:12px;border:1px solid #b8c9db;border-radius:8px;background:#f6f9fc;color:#17304b}.wbe-heading{font-weight:bold;margin-bottom:8px}.wbe-group{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid #d7e1eb}.wbe-group>strong{min-width:160px;color:#28557d}.wbe-group[data-category="Endocrinologie"]>strong{color:#76539a}.wbe-group[data-category="Hématologie"]>strong{color:#8b495a}.wbe-group[data-category="Hépato-gastro"]>strong{color:#84631f}.wbe-result{padding:5px 8px;background:white;border-left:3px solid #8a96a3;border-radius:4px}.wbe-result[data-tone=abnormal]{border-color:#b83b32}.wbe-result[data-tone=normal]{border-color:#27845e}.wbe-result small{display:block;color:#516174;margin-top:4px}.wbe-summary details{margin-top:8px}.wbe-summary button{margin-top:8px}.wbe-native-hidden{display:none!important}';
    doc.head.append(style);
  }
  function refreshSummary() {
    const root = doc.querySelector('#ContentPlaceHolder1_LabelHprimDataStructure') || env.rawContainer?.();
    const old = doc.getElementById('wbe-current-summary'), input = doc.querySelector('#ContentPlaceHolder1_TextBoxHprimTitre'), row = selected();
    if (!root || !input?.value || !row || !env.matches(row) || env.getState().running) { old?.remove(); return; }
    const signature = row.key + '|' + env.contentKey() + '|' + input.value;
    if (old?.dataset.signature === signature && old.nextElementSibling === root) return;
    old?.remove();
    const summary = card(input.value); summary.id = 'wbe-current-summary'; summary.dataset.signature = signature; root.before(summary);
  }
  const dossierCards = new Map();
  function refreshDossier() {
    const patient = new URL(env.location.href).searchParams.get('PatDk');
    for (const [element, entry] of dossierCards) {
      const currentText = text(Array.from(element.childNodes).filter(node => node !== entry.card).map(node => node.textContent).join(' '));
      if (element.isConnected && entry.patient === patient && currentText === entry.title) continue;
      entry.card.remove(); entry.table?.classList.remove('wbe-native-hidden');
      delete element.dataset.wbeEnhanced; dossierCards.delete(element);
    }
    if (!patient) return;
    const entries = env.getValue(env.prefix + 'displayTitles.v1', []).filter(entry => entry.patientId === patient && entry.title);
    for (const element of doc.querySelectorAll('span,label,td,p,div')) {
      if (element.closest('.wbe-summary') || element.dataset.wbeEnhanced || element.childElementCount > 2) continue;
      const entry = entries.find(candidate => text(candidate.title) === text(element.textContent));
      if (!entry || Array.from(element.children).some(child => text(child.textContent) === text(element.textContent))) continue;
      const table = element.closest('table.hprimgrid') || element.parentElement?.querySelector(':scope > table.hprimgrid');
      const summary = card(entry.title, table);
      if (table) table.before(summary); else if (element.tagName === 'TD') element.append(summary); else element.after(summary);
      element.dataset.wbeEnhanced = 'true';
      dossierCards.set(element, {card: summary, table, title: text(entry.title), patient});
    }
  }
  function patientUrl(row) {
    const current = selected();
    if (!row || !current || current.key !== row.key || current.stableKey !== row.stableKey || !env.matches(row)) return '';
    const link = doc.querySelector('#ContentPlaceHolder1_HyperLinkGotoPatient');
    if (!link || !row.cells[2] || !row.cells[3] ||
        fold(link.textContent).replace(/^onglet\s*:\s*/, '') !== fold([row.cells[2], row.cells[3]].join(' '))) return '';
    try {
      const url = new URL(link.getAttribute('href'), env.location.href);
      return url.origin === env.location.origin && url.pathname === '/FolderMedical/PatientViewForm.aspx' &&
        url.searchParams.get('PatDk') && url.searchParams.get('crypt') ? url.href : '';
    } catch (_) { return ''; }
  }
  function patientId() {
    const url = patientUrl(selected());
    return url ? new URL(url).searchParams.get('PatDk') : '';
  }
  function rememberDisplayTitle(title, contentKey) {
    // Cache d'affichage exclusivement WEDA, distinct de JOB_KEY/RESULT_KEY.
    if (env.location.hostname !== 'secure.weda.fr' || env.contentKey() !== contentKey) return;
    const patient = patientId();
    if (!patient) return;
    const key = env.prefix + 'displayTitles.v1';
    const previous = env.getValue(key, []).filter(entry => entry.patientId !== patient || entry.contentKey !== contentKey);
    env.setValue(key, [{patientId: patient, contentKey, title}, ...previous].slice(0, 500));
  }
  function setSource(jobId, contentKey, report, history) {
    // Ce contexte n'est ajouté à aucune requête LM Studio / aucun contexte Heidi.
    env.setValue(env.sourceKey(), {jobId, contentKey, report, history});
  }
  function prepareResultTitle(title, result) {
    const source = env.getValue(env.sourceKey(), null);
    if (!source || source.jobId !== result.jobId || source.contentKey !== result.contentKey) {
      throw new Error('Source locale du résultat non confirmée : aucune écriture WEDA.');
    }
    return protectAnapath(enrichTitle(title, source.report, source.history), source.report);
  }
  function clearSource() { env.deleteValue(env.sourceKey()); }
  const openParam = 'wedaBioPatientOpen';
  function setupPatientShortcut() {
    win.addEventListener('click', event => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const link = event.target.closest?.('#ContentPlaceHolder1_HprimsGrid a[id*="LinkButtonHprimNom_"],#ContentPlaceHolder1_HprimsGrid a[id*="LinkButtonHprimPrenom_"]');
      if (!link) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const row = env.getRows().find(item => item.row === link.closest('tr'));
      if (!row) return;
      const direct = patientUrl(row);
      if (direct) { win.open(direct, '_blank', 'noopener'); return; }
      const options = env.postbackOptions(link), source = link.closest('form');
      if (!source || !options || !/^ctl00\$ContentPlaceHolder1\$HprimsGrid\$ctl\d+\$LinkButtonHprim(?:Nom|Prenom)$/.test(options.target)) {
        env.message('Ouverture du dossier impossible : commande WEDA non confirmée.'); return;
      }
      const token = win.crypto.randomUUID(), key = env.prefix + 'patientOpen.' + token, target = 'wedaBioPatient_' + token;
      const popup = win.open('about:blank', target);
      if (!popup) { env.message('Ouverture bloquée : autorisez les fenêtres surgissantes pour WEDA.'); return; }
      const form = doc.createElement('form');
      try {
        const action = new URL(env.location.href); action.searchParams.set(openParam, token); action.hash = '';
        form.method = 'post'; form.action = action.href; form.target = target; form.hidden = true;
        const fields = new Map(Array.from(source.querySelectorAll('input[type=hidden][name]'))
          .filter(input => !input.disabled && !/ScriptManager|Uploader|__ASYNCPOST/i.test(input.name)).map(input => [input.name, input.value]));
        if (!fields.get('__VIEWSTATE') || !fields.get('__EVENTVALIDATION')) throw new Error('état du formulaire WEDA incomplet');
        fields.set('__EVENTTARGET', options.target); fields.set('__EVENTARGUMENT', options.argument || ''); fields.set('__LASTFOCUS', '');
        for (const [name, value] of fields) {
          const input = doc.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
        }
        env.setValue(key, {rowKey: row.key, stableKey: row.stableKey, createdAt: Date.now()});
        doc.body.append(form); win.HTMLFormElement.prototype.submit.call(form);
      } catch (error) { env.deleteValue(key); popup.close(); env.message('Dossier non ouvert : ' + error.message); }
      finally { form.remove(); }
    }, true);
  }
  function finishPatientOpen() {
    const token = new URL(env.location.href).searchParams.get(openParam);
    if (token === null) return false;
    const key = env.prefix + 'patientOpen.' + token;
    const request = /^[a-f0-9-]{36}$/i.test(token) ? env.getValue(key, null) : null;
    env.deleteValue(key);
    const age = request ? Date.now() - request.createdAt : Infinity;
    const row = request && env.getRows().find(item => item.key === request.rowKey && item.stableKey === request.stableKey);
    const url = age >= 0 && age <= 90000 ? patientUrl(row) : '';
    if (url) { win.opener = null; env.location.replace(url); }
    else {
      const alert = doc.createElement('div'); alert.setAttribute('role', 'alert');
      alert.textContent = 'Dossier non ouvert : identité ou sélection WEDA non confirmée. Cet onglet ne lance aucune analyse.';
      doc.body.prepend(alert);
    }
    return true;
  }
  let timer = null, worker = null;
  const backgroundKey = env.prefix + 'background.v1';
  function stopBackground() { worker?.terminate(); worker = null; }
  function syncBackground() {
    if (!win || env.location.hostname !== 'secure.weda.fr' || env.location.pathname !== '/FolderMedical/HprimForm.aspx') return;
    const state = env.getState();
    if (!env.getValue(backgroundKey, false) || !(state.running || state.autoEnabled)) { stopBackground(); return; }
    if (worker) return;
    try {
      const url = win.URL.createObjectURL(new win.Blob(['setInterval(()=>postMessage("tick"),15000)'], {type: 'text/javascript'}));
      try { worker = new win.Worker(url); } finally { win.URL.revokeObjectURL(url); }
      // Réveil du heartbeat existant ; aucun enregistrement ni passage forcé.
      worker.onmessage = () => { env.heartbeat(); refreshSummary(); };
      worker.onerror = () => { log('background-unavailable'); stopBackground(); };
    } catch (error) { log('background-unavailable', {reason: error.message}); stopBackground(); }
  }
  function setup(dossier = false) {
    setupStyle();
    const refresh = dossier ? refreshDossier : refreshSummary;
    const schedule = () => { if (timer) win.clearTimeout(timer); timer = win.setTimeout(refresh, 150); };
    const observer = new win.MutationObserver(records => {
      if (records.some(record => {
        const parent = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const added = Array.from(record.addedNodes);
        return !parent?.closest('.wbe-summary') && (!added.length || added.some(node => !(node.nodeType === 1 && node.matches?.('.wbe-summary'))));
      })) schedule();
    });
    observer.observe(doc.body, {subtree: true, childList: true, characterData: true});
    doc.addEventListener('input', schedule, true);
    doc.addEventListener('click', event => {
      if (event.isTrusted && event.target.closest?.(panelSelector + ',[id*="ButtonHistoriqueResultat_"]')) historyRevision++;
      schedule();
    }, true);
    if (!dossier) {
      setupPatientShortcut();
      const panel = doc.getElementById(env.panelId), body = panel?.querySelector('.wbh-body');
      if (body) {
        const label = doc.createElement('label'), option = doc.createElement('input');
        option.type = 'checkbox'; option.checked = env.getValue(backgroundKey, false);
        label.append(option, doc.createTextNode(' Maintenir le traitement en arrière-plan'));
        option.addEventListener('change', () => { env.setValue(backgroundKey, option.checked); syncBackground(); });
        body.prepend(label);
        const reanalyse = doc.createElement('button');
        reanalyse.type = 'button'; reanalyse.textContent = 'Réanalyser toute la page';
        reanalyse.addEventListener('click', () => {
          if (env.getState().running) { env.message('Arrêtez le traitement en cours avant de réanalyser la page.'); return; }
          if (win.confirm('Réanalyser toutes les biologies visibles ? Les titres existants seront réécrits.')) env.start();
        });
        body.append(reanalyse);
        const reset = doc.createElement('button');
        reset.type = 'button'; reset.textContent = 'Replacer le menu';
        reset.addEventListener('click', () => {
          env.deleteValue(env.positionKey); panel.style.left = ''; panel.style.top = ''; panel.style.right = '18px'; panel.style.bottom = '112px';
        });
        body.append(reset);
      }
      syncBackground();
    }
    win.addEventListener('pagehide', () => { observer.disconnect(); stopBackground(); });
    win.addEventListener('pageshow', () => {
      observer.observe(doc.body, {subtree: true, childList: true, characterData: true});
      schedule();
      if (!dossier) syncBackground();
    });
    schedule();
  }
  function protectAnapath(title, report) {
    if (!narrative(report)) return title;
    const conclusion = String(report).match(/(?:^|\n)\s*(?:conclusion|diagnostic(?:\s+histologique)?)\s*:\s*([\s\S]+)/i)?.[1];
    if (!conclusion) return title;
    const facts = text(conclusion.split(/\n\s*(?:signature|signé|docteur|dr\b|avis|recommandation|copie|destinataire)/i)[0]);
    if (!/endobrach|barrett|\bEBO\b/i.test(facts)) return title;
    if (!facts || facts.length > 330 || env.forbidden?.(facts)) throw new Error('Conclusion anatomopathologique à vérifier.');
    return 'Anapath : ' + facts;
  }
  function promptRules() {
    return [
      'RÈGLES COMPLÉMENTAIRES DE PRÉSENTATION',
      'Toujours citer CRP et TSH lorsqu’elles sont disponibles, même normales, sans inventer de marqueur absent.',
      'Pour chaque résultat chiffré retenu : nom N valeur si normal, nom ↑ valeur si élevé, nom ↓ valeur si abaissé ; ? si le statut est indéterminé.',
      'Les valeurs et les normes du tableau structuré sont déjà converties dans les unités affichées. Ne pas convertir une seconde fois ni supposer une unité absente.',
      'Écrire HbA1c pour l’hémoglobine glyquée. Conserver HDL et non-HDL selon les règles précédentes, et le DFG disponible avec priorité CKD-EPI.',
      'Une ligne Soit est la valeur absolue du leucocyte immédiatement précédent ; ne pas attribuer un type par ordre supposé.',
      'Conserver les unités. Les antériorités seront ajoutées séparément à partir de WEDA : ne pas inventer de résultat précédent ni de date.',
    ].join('\n');
  }
  return {marker, number, normalizeRow, normalizeRows, reportRows, absolute, selectRow, splitTitle,
    enrichTitle, dateMs, compareHistory, historyEntries, summaryModel, historyDelta, collectHistory,
    rememberDisplayTitle, setSource, prepareResultTitle, clearSource, finishPatientOpen, setup, syncBackground, protectAnapath, promptRules};
}

if (typeof module !== 'undefined') module.exports = {createWedaBiologyEnhancements};
