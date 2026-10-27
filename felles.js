// Felles for popup og bakgrunn (lastes med importScripts i background.js
// og med <script> i popup.html), og lastes inn i Canvas-fanen før delOgBygg,
// malSignatur m.fl. kjøres der.
// NB: verdiene på toppnivå er «var», ikke «const»: fila lastes inn i samme
// Canvas-fane mange ganger, og «const» gir da feilen «Identifier … has already
// been declared» (sett i chrome://extensions 27.10.2026).

// Standard ledetekst til Copilot. Læreren kan endre den i popupen;
// «Standard ↺» henter denne fram igjen.
// NB: «Bruk … «vi»» ble tolket som at læreren skulle snakke som «vi» («det tenker
// jeg» → «det tenker vi», sett i Chrome 26.10.2026). Derfor står det nå uttrykkelig
// at hvem som snakker ikke skal endres.
var STANDARD_LEDETEKST =
  'Oversett teksten under fra bokmål til nynorsk. Bruk e-infinitiv. ' +
  'Ikke endre hvem som snakker: «jeg» blir «eg», «vi» blir «vi» (ikke «me»). ' +
  'Hold tonen varm og enkel, slik en lærer skriver til en elev. ' +
  'Ikke legg til eller ta bort innhold.';

// Faste regler som alltid legges til etter lærerens ledetekst, så de ikke
// kan fjernes ved et uhell. Merkene og @fornavn må overleve, ellers stopper
// innsettingen.
var FASTE_REGLAR =
  'Faste regler (gjelder alltid): Teksten er delt i nummererte biter [1], [2] osv. ' +
  'Svar med én linje per bit, i formatet [nummer] oversatt tekst, i samme rekkefølge. ' +
  'Behold alle merker som {1}, {/1} og {2/} nøyaktig – de markerer formatering, bilder og film. ' +
  'Ord inni et merkepar skal stå inni merkeparet også etter oversettelsen. ' +
  'Behold @fornavn nøyaktig som det står. Svar bare med bitene, uten innledning eller forklaring.';

function lagPrompt(ledetekst, bitar) {
  return `${ledetekst}\n${FASTE_REGLAR}\n\n---\n` +
    bitar.map((b, i) => `[${i + 1}] ${b}`).join('\n');
}

// ─── DEL OG BYGG (merke-metoden) ─────────────────────────────────────────────
// Nynorsk skal se ut akkurat som bokmål-malen. Derfor sendes bare TEKSTEN til
// Copilot; HTML-koden (bilder, film, farger, lenker, tabeller, justering)
// blir liggende urørt og får den oversatte teksten satt tilbake på plass.
//
// delOgBygg(mal)        → { bitar: ['Hei, @fornavn!', 'Du har {1}svart rett{/1} …', …] }
// delOgBygg(mal, svar)  → { html } eller { avvik: [...] }
//
// Hver bit er en sammenhengende tekst inne i ett avsnitt, listepunkt, tabellcelle
// e.l. Formatering inne i biten blir merker: {k}…{/k} for elementer med innhold
// (fet, farge, lenke), {k/} for elementer som aldri skal røres (bilde, film,
// linjeskift). Nummereringen er den samme hver gang for samme mal, så delingen
// kan gjøres på nytt når svaret skal bygges inn.
//
// Funksjonen er selvstendig (ingen ytre variabler), fordi background.js sender
// den inn i SpeedGrader-fanen med chrome.scripting.executeScript.
function delOgBygg(malHtml, svarTekst) {
  const BLOKK = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL',
    'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION',
    'DL', 'DT', 'DD', 'PRE', 'CAPTION']);
  // Urørlige elementer: kopieres tilbake nøyaktig som de var, med alt innhold
  const URØRLEG = new Set(['IMG', 'BR', 'HR', 'IFRAME', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'SVG',
    'PICTURE', 'SOURCE', 'TRACK', 'CANVAS', 'SCRIPT', 'STYLE', 'INPUT', 'MATH']);
  const MERKE = /\{(\/?)(\d+)(\/?)\}/g;
  const harBokstav = s => /\p{L}/u.test(s.replace(MERKE, ''));

  const rot = document.createElement('div');
  rot.innerHTML = malHtml;
  const merke = {};
  const bitar = [];
  let nr = 0;

  const ser = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const k = ++nr;
    merke[k] = n;
    if (URØRLEG.has(n.tagName.toUpperCase()) || !n.childNodes.length) return `{${k}/}`;
    return `{${k}}` + Array.from(n.childNodes).map(ser).join('') + `{/${k}}`;
  };
  const samle = (el) => {
    let løp = [];
    const flush = () => {
      if (!løp.length) return;
      const tekst = løp.map(ser).join('').trim();
      if (harBokstav(tekst)) bitar.push({ nodar: løp, tekst });
      løp = [];
    };
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 1 && BLOKK.has(c.tagName.toUpperCase())) { flush(); samle(c); }
      else løp.push(c);
    }
    flush();
  };
  samle(rot);

  if (svarTekst == null) return { bitar: bitar.map(b => b.tekst) };

  // Les svaret: let etter [1], [2], [3] … i rekkefølge hvor som helst i teksten,
  // ikke bare først på linja. Copilot slår av og til to biter sammen på én linje
  // (sett i Chrome 26.10.2026: «bit 2 manglar»). En bit inneholder aldri linjeskift
  // (de er merker), så tekst på nye linjer etter en bit (f.eks. en forklaring) kuttes.
  // Copilots «Kopier»-knapp legger skråstrek foran markdown-tegn (f.eks. «\[2]») – fjernes.
  const svar = svarTekst.replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\\([\[\]{}*_#+\-.!()|>~`])/g, '$1');
  const treff = [];
  let frå = 0;
  for (let i = 1; ; i++) {
    const idx = svar.indexOf(`[${i}]`, frå);
    if (idx < 0) break;
    treff.push({ i, idx, start: idx + `[${i}]`.length });
    frå = idx + 1;
  }
  const omsett = {};
  treff.forEach((t, k) => {
    const slutt = k + 1 < treff.length ? treff[k + 1].idx : svar.length;
    omsett[t.i] = svar.slice(t.start, slutt).trim().split(/\r?\n/)[0].trim();
  });

  // Bygg en bit fra oversatt tekst + originale elementer
  const bygg = (tekst) => {
    const frag = document.createDocumentFragment();
    const stabel = [{ el: frag, k: 0 }];
    const brukt = [];
    let pos = 0, m;
    MERKE.lastIndex = 0;
    while ((m = MERKE.exec(tekst))) {
      if (m.index > pos) stabel[stabel.length - 1].el.append(tekst.slice(pos, m.index));
      pos = MERKE.lastIndex;
      const k = +m[2];
      const orig = merke[k];
      if (!orig) throw new Error(`ukjent merke {${k}}`);
      if (m[3]) { stabel[stabel.length - 1].el.append(orig.cloneNode(true)); brukt.push(k); }
      else if (!m[1]) {
        const kl = orig.cloneNode(false);
        stabel[stabel.length - 1].el.append(kl);
        stabel.push({ el: kl, k });
        brukt.push(k);
      } else {
        if (stabel[stabel.length - 1].k !== k) throw new Error(`merke {/${k}} står feil`);
        stabel.pop();
      }
    }
    if (pos < tekst.length) stabel[stabel.length - 1].el.append(tekst.slice(pos));
    if (stabel.length !== 1) throw new Error('merke er ikkje lukka');
    return { frag, brukt };
  };

  const avvik = [];
  const bygde = bitar.map((b, i) => {
    const t = omsett[i + 1];
    if (t === undefined || !harBokstav(t)) { avvik.push(`bit ${i + 1} manglar`); return null; }
    const venta = Array.from(b.tekst.matchAll(/\{(\d+)\/?\}/g)).map(x => +x[1]).sort((a, c) => a - c).join(',');
    try {
      const { frag, brukt } = bygg(t);
      const fått = brukt.sort((a, c) => a - c).join(',');
      if (fått !== venta) { avvik.push(`bit ${i + 1}: merka stemmer ikkje`); return null; }
      return frag;
    } catch (e) { avvik.push(`bit ${i + 1}: ${e.message}`); return null; }
  });
  if (Object.keys(omsett).length > bitar.length) avvik.push('Copilot svarte med fleire bitar enn malen har');
  if (avvik.length) return { avvik };

  // Alt i orden: bytt ut bitene i original-HTML-en
  bitar.forEach((b, i) => {
    b.nodar[0].parentNode.insertBefore(bygde[i], b.nodar[0]);
    b.nodar.forEach(n => n.remove());
  });
  return { html: rot.innerHTML };
}

// ─── FINGERAVTRYKK OG MALSIDE (kolonne 3 = nynorsk) ──────────────────────────
// Malsiden har kolonnene Tittel innlevering | Bokmål | Nynorsk. Bokmål er fasit.
// Hver nynorsk-celle som er laget av utvidelsen, får data-bm="<fingeravtrykk av
// bokmålscellen>". Stemmer ikke fingeravtrykket lenger, er bokmål endret og
// nynorsken må oversettes på nytt. Nynorsk UTEN fingeravtrykk er skrevet for hånd
// og røres ikke.

// Kort hash (djb2)
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Fingeravtrykk av en celle: tekst, tagger og bilde-/film-/lenkeadresser – ikke
// stil eller attributtrekkefølge, som Canvas kan rydde i når siden lagres.
function malSignatur(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  let s = '';
  const gå = (n) => {
    if (n.nodeType === 3) { s += n.textContent.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    s += `<${n.tagName.toLowerCase()} ${n.getAttribute('src') || n.getAttribute('href') || ''}>`;
    n.childNodes.forEach(gå);
    s += '</>';
  };
  d.childNodes.forEach(gå);
  return hash(s.replace(/\s+/g, ' ').trim());
}

// Fingeravtrykk av innholdet slik læreren ser det: ordene (uten mellomrom) og
// bilde-/filmadresser. Tagger og mellomrom telles ikke – Canvas-editoren rydder
// i dem (tomme <span>, <br>, &nbsp;) i ALLE celler hver gang siden lagres, og
// det ga falsk ✋ på mange celler når læreren rettet én (fag 597, 27.10.2026).
// Prefikset «t:» skiller det fra det eldre malSignatur-avtrykket.
function tekstSignatur(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  const media = Array.from(d.querySelectorAll('img,iframe,video,audio,source,object,embed'))
    .map(n => n.getAttribute('src') || n.getAttribute('data') || '').join('|');
  return 't:' + hash(d.textContent.replace(/\s+/g, '') + '|' + media);
}

// Stemmer cellen med et lagret fingeravtrykk (nytt «t:»-format eller eldre malSignatur)?
function sammeInnhald(html, lagra) {
  if (!lagra) return false;
  return lagra.startsWith('t:') ? tekstSignatur(html) === lagra : malSignatur(html) === lagra;
}

// Har cellen innhold (tekst eller bilde/film)?
function harInnhald(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return !!(d.textContent.trim() || d.querySelector('img,iframe,video,audio,object,embed'));
}

// ─── KOLONNER OG VEILEDNING PÅ MALSIDEN ──────────────────────────────────────
// Kolonnene finnes på OVERSKRIFTEN, ikke plassering, så ekstra kolonner læreren
// har selv (f.eks. «Notat») aldri blir overskrevet:
// tittel = første kolonne; bokmål = «Bokmål», ellers «Maltekst», ellers kolonne 2;
// nynorsk = «Nynorsk» (-1 = mangler – legges inn rett etter bokmål).
function cellerIRad(tr) {
  return Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
}

function finnKolonnar(tabell) {
  const hovud = tabell.querySelector('tr');
  const namn = hovud ? cellerIRad(hovud).map(c => c.textContent.trim().toLowerCase()) : [];
  let bm = namn.indexOf('bokmål');
  if (bm < 0) bm = namn.indexOf('maltekst');
  if (bm < 0) bm = 1;
  return { hovud, tittel: 0, bm, nn: namn.indexOf('nynorsk') };
}

// Datarader: alle rader etter overskriften, unntatt mellomoverskrifter
// («Leksjon 1–15», merket data-mal-seksjon eller med bare én celle)
function dataRader(tabell) {
  return Array.from(tabell.querySelectorAll('tr')).slice(1)
    .filter(tr => !tr.hasAttribute('data-mal-seksjon') && cellerIRad(tr).length >= 2);
}

var RETTLEIING_VERSJON = '7';
var RETTLEIING_HTML =
  `<div data-mal-rettleiing="${RETTLEIING_VERSJON}" style="border: 1px solid #b6d4ea; background-color: #f0f7fb; ` +
  'border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; font-size: 12pt; line-height: 1.5;">' +
  '<p style="margin: 0 0 6px 0;"><strong>📋 Malside for Chrome-utvidelsen «Canvas – Sett inn mal»</strong></p>' +
  '<p style="margin: 0 0 6px 0;">Utvidelsen henter malene herfra og setter dem inn i SpeedGrader. Bokmål er fasit – nynorsken ' +
  'lages av utvidelsen med Microsoft 365 Copilot. Med utvidelsen installert ser du en verktøylinje over tabellen med status, ' +
  'ledetekst og «Oversett alle på nytt».</p>' +
  '<ul style="margin: 0; padding-left: 20px;">' +
  '<li><strong>Én mal:</strong> Endrer du teksten i Bokmål-cellen og lagrer siden, oversetter utvidelsen malen til nynorsk. ' +
  'Bilder, film og formatering blir med. @fornavn byttes ut med elevens fornavn.</li>' +
  '<li><strong>Ledeteksten:</strong> Endrer du ledeteksten (instruksen til Copilot), skjer ingenting med nynorsken som står der. ' +
  'Den nye ledeteksten brukes neste gang en mal oversettes – når du endrer en bokmålstekst eller skriver en ny mal. ' +
  'Ledeteksten gjelder for hele malsiden, også for kolleger som bruker den.</li>' +
  '<li><strong>Alle malene:</strong> Velger du «Oversett alle på nytt», oversettes alle malene på nytt etter ledeteksten. ' +
  'Nynorsk du har rettet selv (✋), blir stående. Vil du ta den med, krysser du av for «Ta med … rettet for hånd» ' +
  'i bekreftelsen som kommer når du trykker knappen.</li>' +
  '<li><strong>Dine rettelser:</strong> Retter du i Nynorsk-cellen, blir rettelsen stående – til du endrer bokmålet i samme rad, ' +
  'eller tar den med i «Oversett alle på nytt».</li>' +
  '<li><strong>Tittel innlevering</strong> er koblet til oppgaven i Canvas (lenken). Nye innleveringer og nye navn hentes med ' +
  '«📄 Lag malside fra modulene i dette faget» i utvidelsen. Rader merket ⚠ finnes ikke lenger i modulene.</li>' +
  '<li><strong>Rediger siden i Chrome med utvidelsen installert</strong>, innlogget i Office 365 (skolekontoen). ' +
  'Ellers oppdateres nynorsken neste gang siden åpnes der.</li>' +
  '<li>Ikke endre navnene på kolonnene <strong>Bokmål</strong> og <strong>Nynorsk</strong>. Andre kolonner kan du ha som du vil. ' +
  'Denne boksen holdes ved like av utvidelsen.</li>' +
  '</ul></div>';

// Ledeteksten følger malsiden (felles for alle som bruker den) og lagres som
// data-mal-ledetekst på tabellen. Tom = utvidelsens standard.
function sideLedetekst(tabell) {
  return (tabell?.getAttribute('data-mal-ledetekst') || '').trim() || STANDARD_LEDETEKST;
}

// Sørger for at veiledningsboksen står øverst (før tabellen) i nyeste versjon.
// Returnerer true hvis dokumentet ble endret.
function sikreRettleiing(doc, tabell) {
  const finst = doc.querySelector('[data-mal-rettleiing]');
  if (finst && finst.getAttribute('data-mal-rettleiing') === RETTLEIING_VERSJON) return false;
  const mal = doc.createElement('div');
  mal.innerHTML = RETTLEIING_HTML;
  const boks = mal.firstElementChild;
  if (finst) finst.replaceWith(boks);
  else tabell.parentNode.insertBefore(boks, tabell);
  return true;
}

// Oppgavetitler sammenlignes uten hensyn til mellomrom: Canvas lagrer titler med
// doble mellomrom (f.eks. «🧑‍💻 👨🏾‍💻👩🏻‍💻  L 3 – …»), mens SpeedGrader viser ett.
function normTittel(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

// ─── OPPGAVE-ID I TITTELCELLEN ───────────────────────────────────────────────
// Radene kobles til oppgaven med ID (data-oppgave-id på tittelcellen, ellers
// lenken …/assignments/<id>), ikke bare tittelen. Da tåler malsiden at oppgaver
// får nytt navn, og SpeedGrader finner raden på assignment_id i adressen.
// Rader uten ID (skrevet inn for hånd) sammenlignes på tittel som før.

// Tittelen i cellen, uten ⚠-merket for oppgaver som er fjernet fra modulene
function tittelTekst(celle) {
  if (!celle) return '';
  const k = celle.cloneNode(true);
  k.querySelectorAll('[data-mal-borte]').forEach(e => e.remove());
  return normTittel(k.textContent);
}

function oppgaveIdFor(celle) {
  if (!celle) return '';
  const d = celle.getAttribute('data-oppgave-id');
  if (d) return d;
  const a = celle.querySelector('a[href*="/assignments/"]');
  return (a?.getAttribute('href') || '').match(/\/assignments\/(\d+)/)?.[1] || '';
}
