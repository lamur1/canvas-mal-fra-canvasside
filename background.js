importScripts('felles.js');

let innsettingAktiv = false;
const COPILOT_URL = 'https://m365.cloud.microsoft/chat';

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'sett-inn-mal') await settInnMal(false);
  if (command === 'sett-inn-mal-nynorsk') await settInnMal(true);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sett-inn-mal') {
    settInnMal(false).then(sendResponse);
    return true;
  }
  if (message.action === 'sett-inn-mal-nynorsk') {
    settInnMal(true).then(sendResponse);
    return true;
  }
  if (message.action === 'sett-inn-manuell') {
    settInnManuell(message.html).then(sendResponse);
    return true;
  }
  if (message.action === 'malside-plan') {
    malsidePlan(false).then(sendResponse);
    return true;
  }
  if (message.action === 'malside-lag') {
    malsidePlan(true).then(sendResponse);
    return true;
  }
  if (message.action === 'oppdater-plan') {
    oppdaterPlan(message.kursId).then(sendResponse);
    return true;
  }
  if (message.action === 'oppdater-nynorsk') {
    oppdaterNynorsk(message.kursId).then(sendResponse);
    return true;
  }
  if (message.action === 'malside-handling') {
    malsideHandling(message, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (message.action === 'hent-kursnamn') {
    hentKursnamn(message.kursId).then(sendResponse);
    return true;
  }
});

// Hent kursnamn frå Canvas API
async function hentKursnamn(kursId) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) return { feil: 'Ingen aktiv fane' };

    const resultat = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (kursId) => {
        try {
          const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ||
            decodeURIComponent((document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/) || [])[1] || '');
          const res = await fetch(`/api/v1/courses/${kursId}`, {
            headers: { 'Accept': 'application/json', 'X-CSRF-Token': csrfToken }
          });
          if (!res.ok) return { feil: `HTTP ${res.status}` };
          const data = await res.json();
          return { namn: data.name || data.course_code || `Kurs ${kursId}` };
        } catch (e) {
          return { feil: e.message };
        }
      },
      args: [kursId]
    });

    return resultat?.[0]?.result || { feil: 'Ingen respons' };
  } catch (e) {
    return { feil: e.message };
  }
}

// ─── MELDING MIDT PÅ SKJERMEN ────────────────────────────────────────────────
// Snarveiene (og Stream Deck) kjører uten at popupen er åpen. Derfor vises
// status og feil som et kort midt på skjermen i Canvas-fanen.
// · info (utvidelsen jobber): mørk bakgrunn SPERRER siden til neste melding –
//   læreren skal ikke redigere malsiden eller sende kommentaren imens.
// · ok: forsvinner av seg selv etter varighet ms, og siden er fri igjen.
// · feil: står til læreren klikker «OK».
// Sikkerhetsventil: sperren fjernes av seg selv etter 3 min om ingenting skjer.
async function visMelding(tabId, tekst, type = 'info', varighet = 4000) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (tekst, type, varighet) => {
        const ID = 'mal-utviding-melding';
        let bak = document.getElementById(ID);
        if (!bak) {
          bak = document.createElement('div');
          bak.id = ID;
          bak.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
            'justify-content:center;background:rgba(0,0,0,.35);transition:opacity .25s;font:15px/1.45 Arial,sans-serif';
          bak.innerHTML = '<div class="kort" role="alertdialog" aria-live="assertive" style="max-width:440px;margin:16px;' +
            'padding:18px 22px;border-radius:10px;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.35);text-align:center">' +
            '<div class="tekst"></div><button type="button" class="ok" style="display:none;margin-top:12px;padding:6px 22px;' +
            'border:0;border-radius:6px;background:#fff;color:#b3261e;font-weight:bold;cursor:pointer">OK</button></div>';
          if (!document.getElementById(ID + '-stil')) {
            const st = document.createElement('style');
            st.id = ID + '-stil';
            st.textContent = '@keyframes malSnurr{to{transform:rotate(360deg)}}';
            document.head.appendChild(st);
          }
          document.body.appendChild(bak);
          bak.querySelector('.ok').addEventListener('click', () => bak.remove());
        }
        const kort = bak.querySelector('.kort');
        const fjern = () => { bak.style.opacity = '0'; setTimeout(() => bak.remove(), 260); };
        kort.style.background = { info: '#0460a7', ok: '#1a7a4a', feil: '#b3261e' }[type] || '#0460a7';
        bak.style.opacity = '1';
        // Bakgrunnen sperrer bare mens utvidelsen jobber og ved feil
        bak.style.pointerEvents = type === 'ok' ? 'none' : 'auto';
        bak.style.background = type === 'ok' ? 'transparent' : 'rgba(0,0,0,.35)';
        const tekstEl = kort.querySelector('.tekst');
        tekstEl.textContent = tekst;
        if (type === 'info') {
          const s = document.createElement('span');
          s.style.cssText = 'display:inline-block;width:14px;height:14px;margin-right:8px;vertical-align:-2px;' +
            'border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:malSnurr .7s linear infinite';
          tekstEl.prepend(s);
        }
        kort.querySelector('.ok').style.display = type === 'feil' ? 'inline-block' : 'none';
        clearTimeout(window.__malMeldingTimer);
        if (type === 'ok') window.__malMeldingTimer = setTimeout(fjern, varighet || 3000);
        else if (type === 'info') window.__malMeldingTimer = setTimeout(fjern, 3 * 60 * 1000);
        if (type === 'feil') kort.querySelector('.ok').focus();
      },
      args: [tekst, type, varighet]
    });
  } catch (e) { /* fanen kan være lukket – meldingen er bare til hjelp */ }
}

// ─── HJELPERE FOR SPEEDGRADER ────────────────────────────────────────────────

// Leser fornavn, oppgavetittel og CSRF-token fra SpeedGrader
async function hentElevinfo(tabId) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      try {
        const navnEl = document.querySelector('[data-testid="selected-student"] span span');
        const fornavn = navnEl ? navnEl.innerText.trim().split(' ')[0] : null;
        const tittelEl = document.querySelector('[data-testid="assignment-link"]');
        const tittel = tittelEl ? tittelEl.innerText.trim() : null;
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ||
          decodeURIComponent((document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/) || [])[1] || '');
        return { fornavn, tittel, csrfToken };
      } catch (e) { return null; }
    }
  });
  return res?.[0]?.result || null;
}

// Henter malen for oppgaven fra malsiden: bokmål (kolonne 2) og eventuell
// nynorsk (kolonne 3). nnGyldig = nynorsken er laget fra dagens bokmål
// (fingeravtrykket stemmer) eller skrevet for hånd (uten fingeravtrykk).
async function hentMal(tabId, malUrl, oppgavetittel, csrfToken, oppgaveId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['felles.js'] });
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (malUrl, oppgavetittel, csrfToken, oppgaveId) => {
      try {
        const match = malUrl.match(/\/courses\/(\d+)\/pages\/([^/?#]+)/);
        if (!match) return { feil: 'Ugyldig Canvas-URL' };
        const res = await fetch(`/api/v1/courses/${match[1]}/pages/${match[2]}`, {
          headers: { 'Accept': 'application/json', 'X-CSRF-Token': csrfToken }
        });
        if (!res.ok) return { feil: `Kunne ikke hente siden: HTTP ${res.status}` };
        const data = await res.json();
        const parser = new DOMParser();
        const doc = parser.parseFromString(data.body, 'text/html');
        const tabell = doc.querySelector('table');
        if (!tabell) return { feil: 'Fant ingen tabell på malsiden.' };
        const kol = finnKolonnar(tabell);
        // Raden finnes på oppgave-ID (tåler omdøping), ellers på tittel
        const rader = dataRader(tabell);
        const treff = (oppgaveId && rader.find(r => oppgaveIdFor(cellerIRad(r)[kol.tittel]) === String(oppgaveId))) ||
          rader.find(r => tittelTekst(cellerIRad(r)[kol.tittel]) === normTittel(oppgavetittel));
        const celle = treff ? cellerIRad(treff)[kol.bm] || null : null;
        const nnCelle = treff && kol.nn >= 0 ? cellerIRad(treff)[kol.nn] || null : null;
        if (!celle) return { feil: `Fant ingen mal for denne oppgaven.` };
        const nn = nnCelle && harInnhald(nnCelle.innerHTML) ? nnCelle.innerHTML : '';
        const nnSig = nnCelle?.getAttribute('data-bm') || '';
        const nnKolonne = kol.nn >= 0;
        return { mal: celle.innerHTML, nn, nnKolonne, ledetekst: sideLedetekst(tabell), nnGyldig: !!nn && (!nnSig || nnSig === malSignatur(celle.innerHTML)) };
      } catch (e) { return { feil: e.message }; }
    },
    args: [malUrl, oppgavetittel, csrfToken, oppgaveId || null]
  });
  return res?.[0]?.result || { feil: 'Fant ingen mal' };
}

// Setter inn malen i kommentarfeltet i SpeedGrader (uendret fra v2.1)
async function settInnIEditor(tabId, malHtml, fornavn) {
  const innSettingResultat = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (mal, fornavn) => {
      return new Promise((resolve) => {
        const TIMEOUT = 15000;
        let avsluttet = false;
        let domObserver = null;

        const tidsbegrensning = setTimeout(() => {
          if (!avsluttet) {
            avsluttet = true;
            if (domObserver) domObserver.disconnect();
            resolve({ ok: false, feil: 'Tidsavbrudd: editoren var ikke klar innen 15 sekunder' });
          }
        }, TIMEOUT);

        function finnSendKnapp() {
          return document.querySelector('button[data-testid="submit-comment-button"]');
        }

        function finnKlarEditor() {
          if (typeof tinymce === 'undefined') return null;
          const editor = tinymce.editors.find(e =>
            e.id?.startsWith('rce-') &&
            e.initialized &&
            e.getContainer()?.offsetParent !== null
          );
          if (!editor) return null;
          const throbber = editor.getContainer()?.querySelector('.tox-throbber');
          if (throbber && throbber.style.display !== 'none') return null;
          return editor;
        }

        function fokuserOgSettInn(editor) {
          if (avsluttet) return;
          avsluttet = true;
          clearTimeout(tidsbegrensning);
          if (domObserver) domObserver.disconnect();

          editor.getBody()?.click();
          editor.focus();

          const medNavn = mal.replace(/@fornavn/gi, fornavn);
          editor.setContent(medNavn);
          editor.fire('input');
          editor.fire('change');
          editor.selection.select(editor.getBody(), true);
          editor.selection.collapse(false);
          editor.focus();
          editor.execCommand('mceInsertContent', false, '\u200B');
          editor.fire('input');
          editor.fire('change');
          editor.setContent(editor.getContent().replace(/\u200B/g, ''));
          editor.fire('input');
          editor.fire('change');
          const textarea = document.getElementById(editor.id);
          if (textarea) {
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
          resolve({ ok: true });
        }

        const editor = finnKlarEditor();
        if (editor && finnSendKnapp()) { fokuserOgSettInn(editor); return; }

        let editorKlar = false;
        let sendKnappKlar = false;
        let klarEditor = null;

        function sjekkOgSettInn() {
          if (avsluttet) return;
          if (editorKlar && sendKnappKlar) fokuserOgSettInn(klarEditor);
        }

        function registrerTinyMCELytter() {
          tinymce.on('AddEditor', ({ editor }) => {
            if (!editor.id?.startsWith('rce-')) return;
            editor.on('init', () => {
              if (avsluttet) return;
              klarEditor = editor;
              editorKlar = true;
              sjekkOgSettInn();
            });
          });
          const e = finnKlarEditor();
          if (e) { klarEditor = e; editorKlar = true; sjekkOgSettInn(); }
        }

        domObserver = new MutationObserver(() => {
          if (avsluttet) { domObserver.disconnect(); return; }
          if (!sendKnappKlar && finnSendKnapp()) { sendKnappKlar = true; sjekkOgSettInn(); }
          if (typeof tinymce !== 'undefined') {
            const e = finnKlarEditor();
            if (e && !editorKlar) { klarEditor = e; editorKlar = true; sjekkOgSettInn(); }
          }
          if (!editorKlar && typeof tinymce !== 'undefined') registrerTinyMCELytter();
        });

        domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        if (typeof tinymce !== 'undefined') registrerTinyMCELytter();
        if (finnSendKnapp()) { sendKnappKlar = true; sjekkOgSettInn(); }
      });
    },
    args: [malHtml, fornavn]
  });

  const res = innSettingResultat?.[0]?.result;
  if (!res?.ok) return { feil: res?.feil || 'Innsetting mislyktes' };
  return { ok: true };
}

// ─── NYNORSK VIA COPILOT ─────────────────────────────────────────────────────
// Bare TEKSTEN i malen (med @fornavn, aldri elevnavnet) sendes til Microsoft 365
// Copilot Chat med lærerens skolekonto, delt i nummererte biter med merker for
// formatering (se delOgBygg i felles.js). Bilder, film, farger, lenker og tabeller
// blir aldri sendt og står urørt – nynorsk ser ut akkurat som bokmål-malen.
// Utvidelsen bruker lærerens Copilot-fane og én fast chat, limer inn ledetekst + biter,
// trykker Send, leser svaret, bygger det inn i malen og går tilbake til SpeedGrader.
// Svaret huskes per oppgave i økten, så neste elev går med en gang.
// Går noe galt, åpnes Copilot-fanen og læreren fullfører for hånd i popupen.

// hash() ligger i felles.js

// Samme antall @fornavn før og etter, ellers settes ingenting inn
function sjekkFornavn(mal, html) {
  const før = (mal.match(/@fornavn/gi) || []).length;
  const etter = (html.match(/@fornavn/gi) || []).length;
  if (før !== etter) {
    return { feil: `Copilot endret @fornavn (${før} i malen, ${etter} i svaret) – ingenting satt inn.` };
  }
  return { ok: true };
}

function ventPåLasting(tabId, maksMs) {
  return new Promise((ok) => {
    const ferdig = (svar) => {
      chrome.tabs.onUpdated.removeListener(lytter);
      clearTimeout(t);
      ok(svar);
    };
    const lytter = (id, endring) => { if (id === tabId && endring.status === 'complete') ferdig(true); };
    chrome.tabs.onUpdated.addListener(lytter);
    const t = setTimeout(() => ferdig(false), maksMs);
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') ferdig(true); }).catch(() => ferdig(false));
  });
}

// Kjører i Copilot-fanen (MAIN). Tre sensorer: editoren er klar → teksten står
// i feltet og Send er aktiv → svaret er ferdig (kopier-knapp + ingen endringer).
// Ventingen styres av endringer på siden (MutationObserver), ikke av tidtakere
// i løkke – Chrome bremser tidtakere i faner som ligger bak.
// berreLes = meldingen er alt sendt (fra et forsøk bak): bare vent på og les
// siste svar, ikke send på nytt.
// Returnerer alltid logg (tid per steg) og om fanen var synlig – til feilsøking.
async function copilotKøyring(prompt, berreLes) {
  const usynleg = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
  const rein = s => (s || '').replace(usynleg, '').trim();
  const t0 = performance.now();
  const logg = [`start (${document.visibilityState})`];
  const merk = (steg) => logg.push(`${steg} ${Math.round(performance.now() - t0)} ms`);
  const ut = (o) => ({ ...o, logg, synleg: document.visibilityState });

  const ventPå = (sjekk, maksMs) => new Promise((ok) => {
    const nå = sjekk();
    if (nå) return ok(nå);
    const obs = new MutationObserver(() => {
      const r = sjekk();
      if (r) { obs.disconnect(); clearTimeout(t); ok(r); }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['data-lexical-editor', 'aria-label', 'aria-disabled', 'disabled', 'data-testid'] });
    const t = setTimeout(() => { obs.disconnect(); ok(null); }, maksMs);
  });
  // Venter til elementet har stått uendret i roMs (svaret er ferdig skrevet)
  const ventPåRo = (el, roMs, maksMs) => new Promise((ok) => {
    let ro;
    const ferdig = () => { obs.disconnect(); clearTimeout(ro); clearTimeout(maks); ok(); };
    const obs = new MutationObserver(() => { clearTimeout(ro); ro = setTimeout(ferdig, roMs); });
    obs.observe(el, { subtree: true, childList: true, characterData: true });
    ro = setTimeout(ferdig, roMs);
    const maks = setTimeout(ferdig, maksMs);
  });

  const bokser = () => document.querySelectorAll('[data-testid="m365-chat-llm-web-ui-chat-message"]');
  const sisteBoks = () => { const l = bokser(); return l[l.length - 1] || null; };
  const KOPIER = '[data-testid="CopyButtonTestId"]';

  // Sensor 1: Lexical-editoren har koblet seg på chatfeltet
  const felt = await ventPå(() =>
    document.querySelector('#m365-chat-editor-target-element[data-lexical-editor="true"]'), 20000);
  if (!felt) return ut({ feil: 'Copilot-feltet ble ikke klart. Er du logget inn i Copilot med skolekontoen?', steg: 'felt' });
  merk('felt klart');

  let svarBoks;
  if (berreLes) {
    svarBoks = await ventPå(() => { const b = sisteBoks(); return b && b.querySelector(KOPIER) ? b : null; }, 90000);
  } else {
    // Står det alt tekst i feltet: samme tekst (avbrutt forsøk) sendes som den er;
    // annen tekst → be bakgrunnen laste chatten på nytt (tømmer feltet).
    const utanMellomrom = s => rein(s).replace(/\s+/g, '');
    if (rein(felt.innerText) && utanMellomrom(felt.innerText) !== utanMellomrom(prompt)) {
      return ut({ feil: 'Det stod annen tekst i Copilot-feltet.', steg: 'gammal_tekst' });
    }
    if (!rein(felt.innerText)) {
      felt.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', prompt);
      felt.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }

    // Sensor 2: teksten står i feltet og Send-knappen er aktiv
    const aktivSend = () => {
      const s = document.querySelector('button[aria-label="Send"]');
      return s && !s.disabled && s.getAttribute('aria-disabled') !== 'true' ? s : null;
    };
    const send = await ventPå(() => rein(felt.innerText) && aktivSend(), 5000);
    if (!send) return ut({ feil: 'Teksten kom ikke inn i Copilot.', steg: 'innliming' });
    merk('innlimt, Send aktiv');

    // Ny melding kjennes igjen på at SISTE meldingsboks er et nytt element – ikke på
    // antallet, som kan stå stille i en lang chat der Copilot bare viser de siste.
    const førSiste = sisteBoks();
    const nyBoks = () => { const b = sisteBoks(); return b && b !== førSiste ? b : null; };
    const sendt = () => !!nyBoks() || !rein(felt.innerText);
    send.click();

    // Sensor 2b: meldingen er faktisk sendt (ny meldingsboks eller tomt felt).
    // Gir klikket ingen melding, prøves Enter i feltet.
    if (await ventPå(sendt, 3000)) merk('sendt med klikk');
    else {
      felt.focus();
      for (const type of ['keydown', 'keypress', 'keyup']) {
        felt.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
      if (!(await ventPå(sendt, 3000))) return ut({ feil: 'Copilot sendte ikke meldingen.', steg: 'send' });
      merk('sendt med Enter');
    }

    // Sensor 3: ny meldingsboks med kopier-knapp
    svarBoks = await ventPå(() => { const b = nyBoks(); return b && b.querySelector(KOPIER) ? b : null; }, 90000);
  }
  if (!svarBoks) return ut({ feil: 'Fikk ikke svar fra Copilot i tide.', steg: 'svar' });
  merk('kopier-knapp');
  // Kopier-knappen kommer først når Copilot er ferdig – kort ro holder (i en fane
  // bak strekker Chrome tidtakere til ca. 1 s uansett; 1200 ms ga ca. 3 s)
  await ventPåRo(svarBoks, 250, 20000);
  merk('svar ferdig');

  // Svaret leses som ren tekst («[1] …»); delOgBygg legger det inn i malen
  const svar = svarBoks.querySelector('[data-testid="markdown-reply"]');
  const tekst = (svar?.innerText || '').replace(usynleg, '');
  if (!rein(tekst)) return ut({ feil: 'Tomt svar fra Copilot.', steg: 'svar' });
  return ut({ tekst });
}

// Finner Copilot-fanen utvidelsen skal bruke: den den har brukt før, ellers en
// Copilot-fane læreren har åpen. null = ingen finnes (køyrCopilot åpner en ny,
// festet fane). Fanen lukkes aldri.
async function finnCopilotFane() {
  const { copilotTabId } = await chrome.storage.local.get('copilotTabId');
  if (copilotTabId) {
    const t = await chrome.tabs.get(copilotTabId).catch(() => null);
    if (t?.url?.startsWith('https://m365.cloud.microsoft/')) return t;
  }
  const [åpen] = await chrome.tabs.query({ url: 'https://m365.cloud.microsoft/*' });
  return åpen || null;
}

// Venter på at en NY innlasting er ferdig (etter at fanen har fått ny adresse)
function ventPåNyLasting(tabId, maksMs) {
  return new Promise((ok) => {
    let lastar = false;
    const ferdig = (svar) => {
      chrome.tabs.onUpdated.removeListener(lytter);
      clearTimeout(t);
      ok(svar);
    };
    const lytter = (id, endring) => {
      if (id !== tabId) return;
      if (endring.status === 'loading') lastar = true;
      if (endring.status === 'complete' && lastar) ferdig(true);
    };
    chrome.tabs.onUpdated.addListener(lytter);
    const t = setTimeout(() => ferdig(false), maksMs);
  });
}

// Fast oversettelseschat: alle oversettelser går i én Copilot-chat (adressen
// huskes i copilotChat). Ny chat etter MAKS_PER_CHAT oversettelser, når
// ledeteksten endres, eller når læreren trykker «Start ny omsetjingschat».
const MAKS_PER_CHAT = 30;
const FERSK_MS = 4 * 60 * 1000;  // under dette: bruk fanen uten omlasting

const sti = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch (e) { return ''; } };

// Laster en adresse i fanen (vist eller ikke) og venter på ny innlasting
async function lastInn(tabId, url, vis) {
  const lasting = ventPåNyLasting(tabId, 30000);
  await chrome.tabs.update(tabId, vis ? { url, active: true } : { url });
  return lasting;
}

async function køyrIFane(tabId, prompt, berreLes = false) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: copilotKøyring,
      args: [prompt, berreLes]
    });
    return r?.[0]?.result || { feil: 'Ingen respons fra Copilot-fanen.', steg: 'ukjend' };
  } catch (e) {
    // Typisk: fanen ble sendt videre til Microsofts innlogging
    const nå = await chrome.tabs.get(tabId).catch(() => null);
    return nå?.url && !nå.url.startsWith('https://m365.cloud.microsoft/')
      ? { feil: 'Du er ikke innlogget i Copilot. Logg inn med skolekontoen i Copilot-fanen og prøv igjen.', steg: 'innlogging' }
      : { feil: 'Copilot: ' + e.message, steg: 'ukjend' };
  }
}

// Logger hvert forsøk i Service Worker-konsollen og samler dem i sisteLogg
// (chrome.storage.local) – til feilsøking av tid per steg.
let sisteLogg = null;
const loggForsøk = (namn, res) => {
  const linje = `${namn}: ${res.feil ? `FEIL i steg «${res.steg}» – ${res.feil}` : 'OK'}`;
  console.log('[mal] ' + linje, res.logg || []);
  sisteLogg?.forsøk.push({ linje, steg: res.logg || [] });
};

// Kjører copilotKøyring i lærerens Copilot-fane, i den faste chatten.
// 1. Forsøk BAK: fanen ligger blant de andre fanene uten å vises; læreren blir i
//    SpeedGrader. Chatten lastes inn på nytt først – en fane som har ligget bak
//    lenge, bremses ekstra hardt av Chrome, og en fersk innlasting nullstiller det.
// 2. Nødløsning: stopper noe bak, vises fanen og løpet fullføres der (sendt, men
//    ikke lest → bare les svaret, ikke send på nytt). Så tilbake til SpeedGrader.
// Hvert forsøk logges i Service Worker-konsollen med tid per steg («[mal] …»).
// Returnerer { tekst, tabId } eller { feil, tabId, steg }.
async function køyrCopilot(prompt, tilbakeTabId, ltHash) {
  sisteLogg = { tid: Date.now(), forsøk: [] };
  const res = await køyrCopilotIndre(prompt, tilbakeTabId, ltHash);
  sisteLogg.sekund = ((Date.now() - sisteLogg.tid) / 1000).toFixed(1);
  sisteLogg.ok = !res.feil;
  await chrome.storage.local.set({ sisteLogg });
  return res;
}

async function køyrCopilotIndre(prompt, tilbakeTabId, ltHash) {
  const { copilotChat } = await chrome.storage.local.get('copilotChat');
  const brukLagra = !!(copilotChat?.url && copilotChat.antal < MAKS_PER_CHAT && copilotChat.lt === ltHash);
  let mål = brukLagra ? copilotChat.url : COPILOT_URL;
  let iNyChat = !brukLagra;

  let tab = await finnCopilotFane();
  if (!tab) {
    tab = await chrome.tabs.create({ url: COPILOT_URL, active: false, pinned: true });
    await ventPåLasting(tab.id, 30000);
  }
  await chrome.storage.local.set({ copilotTabId: tab.id });

  const forsøk = async (vis, berreLes = false) => {
    const t = Date.now();
    if (!(await lastInn(tab.id, mål, vis))) return { feil: 'Copilot lastet ikke.', steg: 'lasting' };
    const lastMs = Date.now() - t;
    const r = await køyrIFane(tab.id, prompt, berreLes);
    return { ...r, logg: [`omlasting ${lastMs} ms`, ...(r.logg || [])] };
  };

  // 1. Bak. Er forrige oversettelse under 4 min gammel og fanen alt i den faste
  // chatten, sendes det uten omlasting (sparer ca. 3,5 s). Eldre enn det: last på
  // nytt – etter 5 min bak bremser Chrome fanen kraftig.
  const fersk = brukLagra && copilotChat.sist && Date.now() - copilotChat.sist < FERSK_MS &&
    sti(tab.url) === mål;
  let res;
  if (fersk) {
    res = await køyrIFane(tab.id, prompt);
    loggForsøk('Forsøk bak (utan omlasting)', res);
    if (res.steg === 'gammal_tekst' || res.steg === 'felt') {
      res = await forsøk(false);
      loggForsøk('Forsøk bak', res);
    }
  } else {
    res = await forsøk(false);
    loggForsøk('Forsøk bak', res);
  }
  if (brukLagra && ['felt', 'lasting'].includes(res.steg)) {
    // Den faste chatten kan være slettet: prøv en ny chat (fortsatt bak)
    await chrome.storage.local.remove('copilotChat');
    mål = COPILOT_URL;
    iNyChat = true;
    res = await forsøk(false);
    loggForsøk('Forsøk bak i ny chat', res);
  }

  // 2. Nødløsning: vis fanen og fullfør
  let vist = false;
  if (res.feil && res.steg !== 'innlogging') {
    vist = true;
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    if (res.steg === 'svar' || res.steg === 'send' || res.steg === 'innliming') {
      // Ikke last på nytt: meldingen er sendt (les svaret) eller står i feltet (send den)
      await chrome.tabs.update(tab.id, { active: true });
      res = await køyrIFane(tab.id, prompt, res.steg === 'svar');
    } else {
      res = await forsøk(true);
    }
    loggForsøk('Forsøk med synleg fane', res);
  }
  if (res.feil) {
    if (res.steg === 'innlogging') await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    return { ...res, tabId: tab.id };
  }

  // Husk den faste chatten (adressen får chat-ID etter første sending)
  const nå = await chrome.tabs.get(tab.id).catch(() => null);
  const url = sti(nå?.url || '');
  if (/\/chat\/conversation\//.test(url)) {
    const antal = !iNyChat && url === copilotChat?.url ? copilotChat.antal + 1 : 1;
    await chrome.storage.local.set({ copilotChat: { url, lt: ltHash, antal, sist: Date.now() } });
  }

  if (vist && tilbakeTabId) {
    const sg = await chrome.tabs.update(tilbakeTabId, { active: true }).catch(() => null);
    if (sg?.windowId) await chrome.windows.update(sg.windowId, { focused: true }).catch(() => {});
  }
  return { ...res, tabId: tab.id };
}

// Kjører delOgBygg (felles.js) i SpeedGrader-fanen, som har DOM
async function køyrDelOgBygg(tabId, mal, svarTekst) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: delOgBygg,
    args: [mal, svarTekst ?? null]
  });
  return res?.[0]?.result || { avvik: ['ingen respons'] };
}

async function omsettMedCopilot({ kursId, tittel, mal, speedgraderTabId, ledetekst }) {
  const lt = (ledetekst || '').trim() || STANDARD_LEDETEKST;  // ledeteksten på malsiden
  const nokkel = 'nn:' + hash([kursId, tittel, lt, mal].join('\u0001'));

  const lagra = (await chrome.storage.session.get(nokkel))[nokkel];
  if (lagra) return { html: lagra };

  const { bitar } = await køyrDelOgBygg(speedgraderTabId, mal);
  if (!bitar) return await feilmelding(speedgraderTabId, 'Kunne ikke lese malen.');
  if (!bitar.length) return { html: mal };  // ingen tekst å omsetje (berre bilete/film)
  const prompt = lagPrompt(lt, bitar);

  await visMelding(speedgraderTabId, '🈁 Oversetter til nynorsk med Copilot …', 'info', 0);
  const res = await køyrCopilot(prompt, speedgraderTabId, hash(lt));
  let feil = res.feil;
  if (res.tekst) {
    const bygd = await køyrDelOgBygg(speedgraderTabId, mal, res.tekst);
    if (bygd.avvik) feil = `Copilot endret formateringen (${bygd.avvik.slice(0, 2).join('; ')}).`;
    else {
      const sjekk = sjekkFornavn(mal, bygd.html);
      if (sjekk.ok) {
        await chrome.storage.session.set({ [nokkel]: bygd.html });
        return { html: bygd.html };
      }
      feil = sjekk.feil;
    }
  }

  // Reserve: læreren fullfører for hånd. Copilot-fanen vises; popupen viser
  // stegene (kopier tekst → lim inn svar → sett inn).
  await chrome.storage.session.set({
    ventande: { nokkel, mal, prompt, tittel, speedgraderTabId, grunn: feil, tid: Date.now() }
  });
  await visMelding(speedgraderTabId,
    `⚠ ${feil} Copilot er åpnet. Fullfør via utvidelsen (ikonet oppe til høyre).`, 'feil', 15000);
  if (res.tabId) await chrome.tabs.update(res.tabId, { active: true }).catch(() => {});
  return { feil, reserve: true };
}

// ─── OPPDATER NYNORSK PÅ MALSIDEN (kolonne 3) ────────────────────────────────
// «🔄 Oppdater nynorsk» i popupen: oversetter bokmålsmaler som mangler nynorsk
// eller er endret siden sist (fingeravtrykk, se felles.js), skriver resultatet i
// kolonne 3 og lagrer siden én gang. Da trenger nynorsk-knappen i SpeedGrader
// ikke Copilot. Kjører i en Canvas-fane (lærerens innlogging og CSRF-token).

// Kjører en funksjon i Canvas-fanen med felles.js lastet (delOgBygg, malSignatur …)
async function iKanvas(tabId, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['felles.js'] });
  const r = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.[0]?.result;
}

// Leser malsiden: rader med bokmål/nynorsk og fingeravtrykk. Kjører i Canvas-fanen.
async function lesMalside(malUrl) {
  try {
    const m = malUrl.match(/\/courses\/(\d+)\/pages\/([^/?#]+)/);
    if (!m) return { feil: 'Ugyldig URL til malside.' };
    const res = await fetch(`/api/v1/courses/${m[1]}/pages/${m[2]}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { feil: `Kunne ikke lese malsiden: HTTP ${res.status}` };
    const d = await res.json();
    const doc = new DOMParser().parseFromString(d.body || '', 'text/html');
    const tabell = doc.querySelector('table');
    if (!tabell) return { feil: 'Fant ingen tabell på malsiden.' };
    const kol = finnKolonnar(tabell);
    const lt = sideLedetekst(tabell);
    const ltHash = hash(lt);
    const rader = dataRader(tabell).map((tr) => {
      const c = cellerIRad(tr);
      const bm = c[kol.bm]?.innerHTML || '';
      const nnCelle = kol.nn >= 0 ? c[kol.nn] : null;
      const nn = nnCelle?.innerHTML || '';
      const harNn = harInnhald(nn);
      const nnSig = nnCelle?.getAttribute('data-bm') || '';
      const nnFinger = nnCelle?.getAttribute('data-nn') || '';
      // ✋ = nynorsken er endret etter at utvidelsen skrev den (eller skrevet helt for hånd)
      const hand = harNn && (!nnSig || (!!nnFinger && malSignatur(nn) !== nnFinger));
      // 🕘 = oversatt med en annen (eller ukjent, eldre) ledetekst enn den siden har nå
      const eldre = harNn && !!nnSig && !hand && (nnCelle.getAttribute('data-lt') || '') !== ltHash;
      return {
        hand, eldre,
        tittel: tittelTekst(c[kol.tittel]),
        oppgaveId: oppgaveIdFor(c[kol.tittel]),
        borte: !!c[kol.tittel]?.querySelector('[data-mal-borte]'),
        bm, nn,
        harBm: harInnhald(bm), harNn: harInnhald(nn),
        bmSig: harInnhald(bm) ? malSignatur(bm) : '',
        nnSig: nnCelle?.getAttribute('data-bm') || ''
      };
    });
    const rv = doc.querySelector('[data-mal-rettleiing]');
    return { kurs: m[1], side: d.page_id || m[2], oppdatert: d.updated_at, rader,
      nnKolonne: kol.nn >= 0, rettleiingOk: rv?.getAttribute('data-mal-rettleiing') === RETTLEIING_VERSJON,
      ledetekst: (tabell.getAttribute('data-mal-ledetekst') || '').trim(), lt, ltHash };
  } catch (e) { return { feil: e.message }; }
}

// Deler flere rader i biter i ÉN Copilot-melding (hver rad i sin egen <div>),
// eller bygger svaret inn og deler tilbake per rad. Kjører i Canvas-fanen.
function delRader(htmlar, svar) {
  const samla = htmlar.map((h, i) => `<div data-rad="${i}">${h}</div>`).join('');
  const r = delOgBygg(samla, svar);
  if (svar == null || r.avvik) return r;
  const d = document.createElement('div');
  d.innerHTML = r.html;
  return { rader: Array.from(d.querySelectorAll(':scope > div[data-rad]')).map(x => x.innerHTML) };
}

// Skriver nynorsk i kolonne 3 og lagrer. Stopper hvis siden er endret siden den
// ble lest. Legger til kolonnen «Nynorsk» og døper «Maltekst» om til «Bokmål».
async function skrivMalside(malUrl, lestVed, nye, valg) {
  try {
    const m = malUrl.match(/\/courses\/(\d+)\/pages\/([^/?#]+)/);
    const url = `/api/v1/courses/${m[1]}/pages/${m[2]}`;
    const d = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
    if (d.updated_at !== lestVed) return { feil: 'Malsiden ble endret mens oversettelsen pågikk. Prøv igjen – det som er oversatt, er husket.' };
    const doc = new DOMParser().parseFromString(d.body || '', 'text/html');
    const tabell = doc.querySelector('table');
    const settTekst = (celle, tekst) => {
      const w = document.createTreeWalker(celle, NodeFilter.SHOW_TEXT);
      const noder = [];
      while (w.nextNode()) if (w.currentNode.nodeValue.trim()) noder.push(w.currentNode);
      if (!noder.length) { celle.textContent = tekst; return; }
      noder[0].nodeValue = tekst;
      noder.slice(1).forEach(n => { n.nodeValue = ''; });
    };
    const kol = finnKolonnar(tabell);
    const hovud = cellerIRad(kol.hovud);
    if (hovud[kol.bm] && hovud[kol.bm].textContent.trim() !== 'Bokmål') settTekst(hovud[kol.bm], 'Bokmål');
    const nyKolonne = kol.nn < 0;
    const nnIdx = nyKolonne ? kol.bm + 1 : kol.nn;
    if (nyKolonne) {
      // Nynorsk rett etter Bokmål; andre kolonner flyttes ett hakk og røres ikke
      const th = hovud[kol.bm].cloneNode(true);
      settTekst(th, 'Nynorsk');
      hovud[kol.bm].after(th);
      dataRader(tabell).forEach((tr) => {
        const c = cellerIRad(tr);
        const td = c[kol.bm].cloneNode(false);
        td.removeAttribute('data-bm');
        c[kol.bm].after(td);
      });
      tabell.querySelectorAll('tr[data-mal-seksjon] > [colspan]').forEach((c) => {
        c.setAttribute('colspan', String((parseInt(c.getAttribute('colspan'), 10) || 1) + 1));
      });
      // Vanlig malside (tittel | bokmål | nynorsk): breidder 24 / 38 / 38 %
      if (cellerIRad(kol.hovud).length === 3) {
        Array.from(tabell.querySelectorAll('tr')).forEach((tr) => {
          const c = cellerIRad(tr);
          if (c.length === 3) [24, 38, 38].forEach((b, k) => { c[k].style.width = b + '%'; });
        });
      }
    }
    dataRader(tabell).forEach((tr, i) => {
      const ny = nye[i];
      if (!ny) return;
      const td = cellerIRad(tr)[nnIdx];
      td.innerHTML = ny.html;
      td.setAttribute('data-bm', ny.sig);                    // bokmålet nynorsken er laget fra
      if (ny.lt) td.setAttribute('data-lt', ny.lt);           // ledeteksten den er laget med
      td.setAttribute('data-nn', malSignatur(td.innerHTML));  // nynorsken slik utvidelsen skrev den
    });
    // Ny ledetekst for malsiden (tom/standard = fjern attributtet)
    if (valg && 'ledetekst' in valg) {
      const t = (valg.ledetekst || '').trim();
      if (!t || t === STANDARD_LEDETEKST) tabell.removeAttribute('data-mal-ledetekst');
      else tabell.setAttribute('data-mal-ledetekst', t);
    }
    sikreRettleiing(doc, tabell);
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/) || [])[1] || '');
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ wiki_page: { body: doc.body.innerHTML } })
    });
    if (!res.ok) return { feil: `Kunne ikke lagre malsiden: HTTP ${res.status}` };
    return { ok: true };
  } catch (e) { return { feil: e.message }; }
}

// Hvilke rader skal oversettes?
// · auto (standard): rader der bokmål er nytt eller endret. Rader med nynorsk
//   skrevet helt for hånd (uten data-bm) røres ikke.
// · modus 'alle': alle rader med bokmål, unntatt ✋ (med mindre taMedHand).
// · rader: [i, …]: bare disse radene (↻ per rad på malsiden).
function planForRader(rader, valg = {}) {
  const plan = { omset: [], uendra: 0, handskrive: 0, tomme: 0, handOverskrive: 0 };
  rader.forEach((r, i) => {
    if (!r.harBm) { plan.tomme++; return; }
    if (valg.rader) { if (valg.rader.includes(i)) plan.omset.push(i); return; }
    if (valg.modus === 'alle') {
      if (r.hand && !valg.taMedHand) plan.handskrive++;
      else plan.omset.push(i);
      return;
    }
    if (r.harNn && !r.nnSig) plan.handskrive++;
    else if (r.harNn && r.nnSig === r.bmSig) plan.uendra++;
    else { plan.omset.push(i); if (r.hand) plan.handOverskrive++; }
  });
  return plan;
}

async function canvasFane(malUrl) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const opphav = new URL(malUrl).origin;
  if (!tab?.url || new URL(tab.url).origin !== opphav) return null;
  return tab;
}

async function framdrift(o) {
  await chrome.storage.session.set({ oppdatering: { ...o, tid: Date.now() } });
}

// Plan: hva vil skje? (vises i popupen før læreren bekrefter)
async function oppdaterPlan(kursId) {
  const { kurs = [] } = await chrome.storage.local.get('kurs');
  const k = kurs.find(x => x.kursId === kursId);
  if (!k) return { feil: 'Fant ikke faget.' };
  const tab = await canvasFane(k.url);
  if (!tab) return { feil: 'Åpne en Canvas-side i denne fanen først (samme Canvas som malsiden).' };
  const side = await iKanvas(tab.id, lesMalside, [k.url]);
  if (!side || side.feil) return { feil: side?.feil || 'Kunne ikke lese malsiden.' };
  const p = planForRader(side.rader);
  return { plan: { omset: p.omset.length, uendra: p.uendra, handskrive: p.handskrive, tomme: p.tomme, totalt: side.rader.length } };
}

// Én oppdatering om gangen per kurs (auto fra malsiden og SpeedGrader kan treffe samtidig)
const oppdateringPågår = new Set();

// valg.tabId: Canvas-fanen jobben skal kjøre i (ellers den aktive fanen)
// valg.melding: vis framdrift som melding i den fanen (malsiden / SpeedGrader)
// valg.auto: startet av utvidelsen selv – bare sider som alt har Nynorsk-kolonne
async function oppdaterNynorsk(kursId, valg = {}) {
  if (oppdateringPågår.has(kursId)) return { feil: 'Oppdatering av nynorsk pågår allerede.', pågår: true };
  oppdateringPågår.add(kursId);
  try { return await oppdaterNynorskIndre(kursId, valg); }
  finally { oppdateringPågår.delete(kursId); }
}

async function oppdaterNynorskIndre(kursId, valg) {
  const { kurs = [] } = await chrome.storage.local.get('kurs');
  const k = kurs.find(x => x.kursId === kursId);
  if (!k) return { feil: 'Fant ikke faget.' };
  const tab = valg.tabId ? await chrome.tabs.get(valg.tabId).catch(() => null) : await canvasFane(k.url);
  if (!tab) return { feil: 'Åpne en Canvas-side i denne fanen først (samme Canvas som malsiden).' };
  const meld = async (o) => {
    await framdrift({ kursId, ...o });
    if (valg.melding) await visMelding(tab.id, o.tekst, o.ferdig ? (o.ok ? 'ok' : 'feil') : 'info', o.ferdig ? 6000 : 0);
  };

  const side = await iKanvas(tab.id, lesMalside, [k.url]);
  if (!side || side.feil) return { feil: side?.feil || 'Kunne ikke lese malsiden.' };
  if (valg.auto && !side.nnKolonne) return { ok: true, omsett: 0, ikkjeAktiv: true };
  const plan = planForRader(side.rader, valg);
  if (!plan.omset.length) {
    // Siden har Nynorsk-kolonne, men veiledningsboksen mangler/er gammel: legg den inn
    if (side.nnKolonne && !side.rettleiingOk) await iKanvas(tab.id, skrivMalside, [k.url, side.oppdatert, {}]);
    await framdrift({ kursId, ferdig: true, ok: true, tekst: 'Alt er oppdatert – ingenting å oversette.' });
    return { ok: true, omsett: 0 };
  }

  // Ledeteksten følger malsiden
  const lt = side.lt;
  const ltHash = side.ltHash;
  const nye = {};        // radindeks → { html, sig, lt }
  const feila = [];

  // Det som alt er oversatt (tidligere avbrutt kjøring), hentes fra minnet –
  // men ikke når læreren selv ber om ny oversettelse (alle / én rad)
  const minneNøkkel = i => `nnrad:${ltHash}:${side.rader[i].bmSig}`;
  const brukMinne = !valg.modus && !valg.rader;
  const gjenstår = [];
  for (const i of plan.omset) {
    const lagra = brukMinne ? (await chrome.storage.session.get(minneNøkkel(i)))[minneNøkkel(i)] : null;
    if (lagra) nye[i] = { html: lagra, sig: side.rader[i].bmSig, lt: ltHash };
    else gjenstår.push(i);
  }

  // Puljer: flere rader per Copilot-melding (maks ca. 3000 tegn tekst / 6 rader)
  const puljer = [];
  let pulje = [], lengd = 0;
  for (const i of gjenstår) {
    const l = side.rader[i].bm.replace(/<[^>]+>/g, '').length;
    if (pulje.length && (lengd + l > 3000 || pulje.length >= 6)) { puljer.push(pulje); pulje = []; lengd = 0; }
    pulje.push(i); lengd += l;
  }
  if (pulje.length) puljer.push(pulje);

  const omsetPulje = async (rader) => {
    const htmlar = rader.map(i => side.rader[i].bm);
    const delt = await iKanvas(tab.id, delRader, [htmlar, null]);
    if (!delt?.bitar) return false;
    let resultat;
    if (!delt.bitar.length) resultat = htmlar;  // bare bilder/film – ingenting å oversette
    else {
      const svar = await køyrCopilot(lagPrompt(lt, delt.bitar), tab.id, ltHash);
      if (svar.feil) throw new Error(svar.feil);
      const bygd = await iKanvas(tab.id, delRader, [htmlar, svar.tekst]);
      if (!bygd?.rader) return false;
      resultat = bygd.rader;
    }
    for (let k = 0; k < rader.length; k++) {
      const i = rader[k];
      if (!sjekkFornavn(side.rader[i].bm, resultat[k]).ok) return false;
    }
    for (let k = 0; k < rader.length; k++) {
      const i = rader[k];
      nye[i] = { html: resultat[k], sig: side.rader[i].bmSig, lt: ltHash };
      await chrome.storage.session.set({ [minneNøkkel(i)]: resultat[k] });
    }
    return true;
  };

  const n = plan.omset.length;
  const start = valg.modus === 'alle' ? `🔄 Oversetter ${n} ${n === 1 ? 'mal' : 'maler'} på nytt etter ledeteksten …`
    : valg.rader ? '🔄 Oversetter malen på nytt …'
    : `🔄 Bokmål er endret – oversetter ${n} ${n === 1 ? 'mal' : 'maler'} til nynorsk …`;
  await meld({ tekst: start });
  let ferdige = plan.omset.length - gjenstår.length;
  try {
    for (const p of puljer) {
      await meld({ tekst: `Oversetter ${ferdige + 1}–${ferdige + p.length} av ${plan.omset.length} …` });
      if (!(await omsetPulje(p))) {
        // Puljen passet ikke: prøv radene én og én
        for (const i of p) if (!(await omsetPulje([i]))) feila.push(side.rader[i].tittel || `rad ${i + 1}`);
      }
      ferdige += p.length;
    }
  } catch (e) {
    await meld({ ferdig: true, ok: false, tekst: `⚠ Copilot: ${e.message} Det som er oversatt, er husket – prøv igjen.` });
    return { feil: e.message };
  }

  await meld({ tekst: 'Lagrer nynorsk på malsiden …' });
  const skrive = await iKanvas(tab.id, skrivMalside, [k.url, side.oppdatert, nye]);
  if (!skrive?.ok) {
    await meld({ ferdig: true, ok: false, tekst: '⚠ ' + (skrive?.feil || 'Lagringen feilet.') });
    return { feil: skrive?.feil || 'Lagringen feilet.' };
  }
  const omsett = Object.keys(nye).length;
  let tekst = `✓ Nynorsk oppdatert: ${omsett} oversatt` + (feila.length ? `, ${feila.length} feilet (${feila.slice(0, 3).join('; ')})` : '') + '.';
  if (valg.modus === 'alle' && plan.handskrive) tekst += ` ${plan.handskrive} rettet for hånd (✋) er hoppet over.`;
  if (plan.handOverskrive) {
    tekst += ` Merk: ${plan.handOverskrive} ${plan.handOverskrive === 1 ? 'mal du hadde' : 'maler du hadde'} rettet for hånd, ` +
      'er oversatt på nytt fordi bokmålet er endret. Forrige versjon finnes i sidens historikk.';
  }
  await meld({ ferdig: true, ok: !feila.length, tekst });
  return { ok: true, omsett, feila, rader: Object.keys(nye).map(Number).sort((a, b) => a - b) };
}

// ─── LAG MALSIDE FRÅ MODULANE ────────────────────────────────────────────────
// For en lærer som er ny i et fag: utvidelsen leser modulene og lager en
// upublisert malside («Maler tilbakemeldinger – <lærer> – <fag>») med
// veiledningsboks og én rad per innlevering i modulene (oppgave, New Quiz, quiz,
// vurdert diskusjon), i modulrekkefølge. Tittelen er en lenke til oppgaven og
// akkurat lik navnet i SpeedGrader. Mellomoverskrifter per 15 leksjoner.
// Finnes malsiden for faget alt, legges bare innleveringene som mangler, til –
// eksisterende rader røres ikke.

// Kjører i Canvas-fanen: fag, lærer og innleveringer i modulrekkefølge
async function lesInnleveringar(kursId) {
  try {
    const hentAlle = async (url) => {
      let ut = [];
      while (url) {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        ut = ut.concat(await r.json());
        url = (r.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1];
      }
      return ut;
    };
    const kurs = await (await fetch(`/api/v1/courses/${kursId}`, { headers: { Accept: 'application/json' } })).json();
    const meg = await (await fetch('/api/v1/users/self', { headers: { Accept: 'application/json' } })).json();
    const oppg = await hentAlle(`/api/v1/courses/${kursId}/assignments?per_page=100`);
    const viaId = new Map(oppg.map(a => [a.id, a]));
    const viaQuiz = new Map(oppg.filter(a => a.quiz_id).map(a => [a.quiz_id, a]));
    const viaDisk = new Map(oppg.filter(a => a.discussion_topic?.id).map(a => [a.discussion_topic.id, a]));
    const modular = await hentAlle(`/api/v1/courses/${kursId}/modules?per_page=100`);
    const ut = [];
    const sett = new Set();
    for (const m of modular) {
      const nr = (m.name.match(/\bL(?:eksjon)?\s*(\d+)/i) || [])[1];
      const element = await hentAlle(`/api/v1/courses/${kursId}/modules/${m.id}/items?per_page=100`);
      for (const it of element) {
        const a = it.type === 'Assignment' ? viaId.get(it.content_id)
          : it.type === 'Quiz' ? viaQuiz.get(it.content_id)
          : it.type === 'Discussion' ? viaDisk.get(it.content_id) : null;
        if (!a || sett.has(a.id)) continue;
        sett.add(a.id);
        ut.push({ id: String(a.id), navn: a.name.trim(), url: a.html_url, leksjon: nr ? +nr : null });
      }
    }
    return { kursnamn: kurs.name, lærar: meg.name, innleveringar: ut };
  } catch (e) { return { feil: 'Kunne ikke lese modulene: ' + e.message }; }
}

const STIL_TH = 'background-color: #f0f0f0; font-size: 15px; padding: 10px 14px; text-align: left; border: 1px solid #cccccc;';
const STIL_TD = 'padding: 8px 12px; vertical-align: top; border: 1px solid #cccccc;';
const STIL_SEKSJON = 'background-color: #e8eef5; font-weight: bold; padding: 8px 12px; border: 1px solid #cccccc;';
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const seksjonNamn = (l) => l == null ? 'Andre moduler' : `Leksjon ${Math.floor((l - 1) / 15) * 15 + 1}–${Math.floor((l - 1) / 15) * 15 + 15}`;

function lagMalsideHtml(innleveringar) {
  let rader = '';
  let forrige = null;
  for (const inn of innleveringar) {
    const seksjon = seksjonNamn(inn.leksjon);
    if (seksjon !== forrige) {
      rader += `<tr data-mal-seksjon="1"><td colspan="3" style="${STIL_SEKSJON}">${escHtml(seksjon)}</td></tr>`;
      forrige = seksjon;
    }
    rader += `<tr><td style="${STIL_TD} width: 24%;" data-oppgave-id="${escHtml(inn.id)}"><a href="${escHtml(inn.url)}">${escHtml(inn.navn)}</a></td>` +
      `<td style="${STIL_TD} width: 38%;"></td><td style="${STIL_TD} width: 38%;"></td></tr>`;
  }
  return RETTLEIING_HTML +
    '<table style="width: 100%; border-collapse: collapse; border: 1px solid #cccccc;" border="1" cellspacing="4" cellpadding="4">' +
    `<thead><tr><th style="${STIL_TH} width: 24%;">Tittel innlevering</th><th style="${STIL_TH} width: 38%;">Bokmål</th>` +
    `<th style="${STIL_TH} width: 38%;">Nynorsk</th></tr></thead><tbody>${rader}</tbody></table>`;
}

// Kjører i Canvas-fanen: oppretter upublisert side, returnerer adressen
async function opprettMalside(kursId, tittel, body) {
  try {
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/) || [])[1] || '');
    const r = await fetch(`/api/v1/courses/${kursId}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ wiki_page: { title: tittel, body, published: false, editing_roles: 'teachers' } })
    });
    if (!r.ok) return { feil: `Kunne ikke lage siden: HTTP ${r.status}` };
    const d = await r.json();
    return { url: d.html_url };
  } catch (e) { return { feil: e.message }; }
}

// Kobler malsidens rader til innleveringene i modulene. Brukes både til å
// planlegge (skriv=false: bare tell) og utføre (skriv=true). Kjører i Canvas-fanen.
// · rad med samme oppgave-ID: tittelen oppdateres hvis oppgaven har fått nytt navn
// · rad uten ID men med samme tittel: får ID og lenke (kobles til oppgaven)
// · innlevering uten rad: ny rad etter nærmeste foregående innlevering
// · rad med ID som ikke lenger finnes i modulene: merkes ⚠ (slettes aldri)
// Bokmål, nynorsk og andre kolonner røres ikke.
async function synkInnleveringar(malUrl, alle, skriv, lestVed) {
  try {
    const m = malUrl.match(/\/courses\/(\d+)\/pages\/([^/?#]+)/);
    const url = `/api/v1/courses/${m[1]}/pages/${m[2]}`;
    const d = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
    if (skriv && lestVed && d.updated_at !== lestVed) return { feil: 'Malsiden er endret siden den ble lest. Prøv igjen.' };
    const doc = new DOMParser().parseFromString(d.body || '', 'text/html');
    const tabell = doc.querySelector('table');
    if (!tabell) return { feil: 'Fant ingen tabell på malsiden.' };
    const kol = finnKolonnar(tabell);
    const rader = dataRader(tabell);
    const viaId = new Map(), viaNamn = new Map();
    rader.forEach((tr) => {
      const c = cellerIRad(tr)[kol.tittel];
      const id = oppgaveIdFor(c);
      if (id) viaId.set(id, tr); else viaNamn.set(tittelTekst(c), tr);
    });
    const tal = { nye: 0, omdøypt: 0, kopla: 0, borte: 0, tilbake: 0 };
    const iModular = new Set(alle.map(i => i.id));
    const radFor = new Map();   // innlevering-ID → rad (til plassering av nye)
    const mønster = rader[0];
    const antalKol = cellerIRad(kol.hovud).length;
    const lenkje = (celle, inn) => {
      let a = celle.querySelector('a');
      if (!a) {
        a = doc.createElement('a');
        Array.from(celle.childNodes).filter(n => !(n.nodeType === 1 && n.hasAttribute('data-mal-borte'))).forEach(n => a.appendChild(n));
        celle.prepend(a);
      }
      a.setAttribute('href', inn.url);
      return a;
    };

    alle.forEach((inn, j) => {
      let tr = viaId.get(inn.id);
      if (tr) {
        const c = cellerIRad(tr)[kol.tittel];
        if (tittelTekst(c) !== normTittel(inn.navn)) {
          tal.omdøypt++;
          if (skriv) lenkje(c, inn).textContent = inn.navn;
        }
      } else if ((tr = viaNamn.get(normTittel(inn.navn)))) {
        viaNamn.delete(normTittel(inn.navn));
        tal.kopla++;
        if (skriv) { const c = cellerIRad(tr)[kol.tittel]; c.setAttribute('data-oppgave-id', inn.id); lenkje(c, inn); }
      } else {
        tal.nye++;
        if (skriv) {
          tr = doc.createElement('tr');
          for (let k = 0; k < antalKol; k++) {
            const mal = mønster ? cellerIRad(mønster)[k] : null;
            const td = mal ? mal.cloneNode(false) : doc.createElement('td');
            td.removeAttribute('data-bm');
            td.removeAttribute('data-oppgave-id');
            if (!mal) td.setAttribute('style', 'padding: 8px 12px; vertical-align: top; border: 1px solid #cccccc;');
            tr.appendChild(td);
          }
          const c = tr.children[kol.tittel];
          c.setAttribute('data-oppgave-id', inn.id);
          const a = doc.createElement('a');
          a.href = inn.url;
          a.textContent = inn.navn;
          c.appendChild(a);
          let forrige = null;
          for (let i = j - 1; i >= 0 && !forrige; i--) forrige = radFor.get(alle[i].id) || null;
          if (forrige) forrige.after(tr);
          else (tabell.querySelector('tbody') || tabell).appendChild(tr);
        }
      }
      if (tr) {
        radFor.set(inn.id, tr);
        const merke = cellerIRad(tr)[kol.tittel]?.querySelector('[data-mal-borte]');
        if (merke) { tal.tilbake++; if (skriv) merke.remove(); }
      }
    });

    // Rader med ID som ikke lenger finnes i modulene: merk med ⚠
    viaId.forEach((tr, id) => {
      if (iModular.has(id)) return;
      const c = cellerIRad(tr)[kol.tittel];
      if (c.querySelector('[data-mal-borte]')) return;
      tal.borte++;
      if (skriv) {
        const s = doc.createElement('span');
        s.setAttribute('data-mal-borte', '1');
        s.setAttribute('style', 'color: #b3261e; font-size: 12px;');
        s.textContent = ' ⚠ finnes ikke lenger i modulene';
        c.appendChild(s);
      }
    });

    const endringar = tal.nye + tal.omdøypt + tal.kopla + tal.borte + tal.tilbake;
    if (!skriv || !endringar) return { ok: true, tal, endringar, oppdatert: d.updated_at };
    sikreRettleiing(doc, tabell);
    const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/) || [])[1] || '');
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ wiki_page: { body: doc.body.innerHTML } })
    });
    if (!res.ok) return { feil: `Kunne ikke lagre malsiden: HTTP ${res.status}` };
    return { ok: true, tal, endringar };
  } catch (e) { return { feil: e.message }; }
}

// Plan og utføring fra popupen. Faget = faget i den aktive fanen.
async function malsidePlan(utfør) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const kursId = tab?.url?.match(/\/courses\/(\d+)/)?.[1];
  if (!kursId) return { feil: 'Åpne faget i Canvas først (en side i faget, f.eks. Moduler).' };
  const info = await iKanvas(tab.id, lesInnleveringar, [kursId]);
  if (!info || info.feil) return { feil: info?.feil || 'Kunne ikke lese modulene.' };
  if (!info.innleveringar.length) return { feil: 'Fant ingen innleveringer i modulene i dette faget.' };

  const { kurs = [] } = await chrome.storage.local.get('kurs');
  const k = kurs.find(x => x.kursId === kursId);
  const tittel = `Maler tilbakemeldinger – ${info.lærar} – ${info.kursnamn}`;

  if (!k) {
    if (!utfør) return { plan: { ny: true, tittel, antal: info.innleveringar.length } };
    const laga = await iKanvas(tab.id, opprettMalside, [kursId, tittel, lagMalsideHtml(info.innleveringar)]);
    if (!laga?.url) return { feil: laga?.feil || 'Kunne ikke lage siden.' };
    kurs.push({ kursId, url: laga.url, namn: info.kursnamn });
    await chrome.storage.local.set({ kurs });
    await chrome.tabs.update(tab.id, { url: laga.url });
    return { ok: true, ny: true, tittel, antal: info.innleveringar.length };
  }

  const plan = await iKanvas(tab.id, synkInnleveringar, [k.url, info.innleveringar, false, null]);
  if (!plan?.ok) return { feil: plan?.feil || 'Kunne ikke lese malsiden.' };
  if (!utfør) return { plan: { ny: false, namn: k.namn, antal: info.innleveringar.length, tal: plan.tal, endringar: plan.endringar } };
  if (!plan.endringar) return { ok: true, ny: false, tal: plan.tal, endringar: 0 };
  const res = await iKanvas(tab.id, synkInnleveringar, [k.url, info.innleveringar, true, plan.oppdatert]);
  if (!res?.ok) return { feil: res?.feil || 'Kunne ikke oppdatere malsiden.' };
  return { ok: true, ny: false, tal: res.tal, endringar: res.endringar };
}

// ─── AUTO: OPPDATER NÅR MALSIDEN VISES ───────────────────────────────────────
// Når læreren lagrer malsiden, går Canvas tilbake til visningen av siden. Da (og
// hver gang siden vises) sjekkes fingeravtrykkene, og rader med endret bokmål
// oversettes i bakgrunnen. Bare sider som alt har Nynorsk-kolonne (læreren har
// valgt det med 🔄). Etterpå lastes siden på nytt, så ny nynorsk vises.
const malsideSti = (u) => {
  try { const x = new URL(u); return (x.origin + x.pathname).replace(/\/edit\/?$/, '').replace(/\/$/, ''); }
  catch (e) { return ''; }
};
const sistAuto = new Map();  // tabId → tid (hindrer doble kjøringer ved samme innlasting)

// Lytter både etter ferdig innlasting og etter adresseendring: etter «Lagre» bytter
// Canvas fra /edit til visning UTEN ny innlasting (bare adressen endres – sett i
// Chrome 26.10.2026: varselet kom først når siden ble lastet på nytt for hånd).
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if ((info.status !== 'complete' && !info.url) || !tab.url) return;
  if (!/\/courses\/\d+\/pages\/[^/]+\/?$/.test(new URL(tab.url).pathname)) return;  // ikke /edit
  const { kurs = [] } = await chrome.storage.local.get('kurs');
  const k = kurs.find(x => malsideSti(x.url) === malsideSti(tab.url));
  if (!k) return;
  // Etter adresseendring: gi Canvas et øyeblikk til å bli ferdig med visningen
  if (info.url && info.status !== 'complete') await new Promise(r => setTimeout(r, 1500));
  // Automatisk oppdatering høyst én gang per 5 s per fane (vår egen omlasting
  // etter skriving kommer innenfor den tiden og går rett til verktøylinja)
  if (Date.now() - (sistAuto.get(tabId) || 0) >= 5000) {
    sistAuto.set(tabId, Date.now());
    const res = await oppdaterNynorsk(k.kursId, { tabId, melding: true, auto: true });
    if (res.ok && res.omsett > 0) { lastMalsidePåNytt(tabId, k, 2500, res.rader); return; }
  }
  await visVerktøy(tabId, k);
});

// Laster malsiden på nytt (så ny nynorsk vises) hvis fanen fortsatt viser den
// rullTil: radindekser å rulle til og utheve etter omlasting, eller 'verktøy'
async function lastMalsidePåNytt(tabId, k, ventMs = 2500, rullTil = null) {
  const nå = await chrome.tabs.get(tabId).catch(() => null);
  if (nå && malsideSti(nå.url) === malsideSti(k.url) && !/\/edit/.test(nå.url)) {
    if (rullTil) await chrome.storage.session.set({ [`rull:${tabId}`]: { rullTil, tid: Date.now() } });
    setTimeout(() => chrome.tabs.reload(tabId).catch(() => {}), ventMs);
  }
}

// ─── VERKTØYLINJE PÅ MALSIDEN ────────────────────────────────────────────────
// Vises bare i visningen av malsiden, bare med utvidelsen, og lagres aldri i
// siden: status for nynorsken, ledeteksten (felles for malsiden), «Oversett alle
// på nytt» og merker per rad (🕘 eldre ledetekst, ✋ rettet for hånd, ↻ én rad).
async function visVerktøy(tabId, k) {
  const side = await iKanvas(tabId, lesMalside, [k.url]).catch(() => null);
  if (!side || side.feil) return;
  const r = side.rader;
  const status = {
    kursId: k.kursId,
    nnKolonne: side.nnKolonne,
    ledetekst: side.lt,
    standard: STANDARD_LEDETEKST,
    antalBm: r.filter(x => x.harBm).length,
    tal: {
      oppdatert: r.filter(x => x.harBm && x.harNn && !x.hand && !x.eldre && x.nnSig === x.bmSig).length,
      eldre: r.filter(x => x.harBm && x.eldre).length,
      hand: r.filter(x => x.harBm && x.hand).length,
      mangler: r.filter(x => x.harBm && (!x.harNn || (x.nnSig && x.nnSig !== x.bmSig))).length
    },
    merker: r.map(x => ({ eldre: x.harBm && x.eldre, hand: x.harBm && x.hand, kan: x.harBm }))
  };
  const nøkkel = `rull:${tabId}`;
  const rull = (await chrome.storage.session.get(nøkkel))[nøkkel];
  if (rull) {
    await chrome.storage.session.remove(nøkkel);
    if (Date.now() - rull.tid < 60000) status.rullTil = rull.rullTil;
  }
  await iKanvas(tabId, teiknVerktøy, [status]).catch(() => {});
}

// Kjører i malside-fanen (isolert verden, felles.js lastet)
function teiknVerktøy(status) {
  const tabell = document.querySelector('.show-content table, .user_content table');
  if (!tabell) return;
  document.getElementById('mal-verktoy')?.remove();
  document.querySelectorAll('.mal-merke, .mal-rad-knapp').forEach(e => e.remove());
  if (!document.getElementById('mal-verktoy-stil')) {
    const st = document.createElement('style');
    st.id = 'mal-verktoy-stil';
    st.textContent =
      '#mal-verktoy{border:1px solid #b6d4ea;background:#f6f9fc;border-radius:6px;padding:10px 14px;margin:0 0 12px 0;' +
      'font:12pt/1.45 Lato,Arial,sans-serif;color:#2d3b45}' +
      '#mal-verktoy button{font:11pt Lato,Arial,sans-serif;border-radius:5px;padding:5px 12px;cursor:pointer;border:1px solid #0460a7}' +
      '#mal-verktoy .hoved{background:#0460a7;color:#fff}#mal-verktoy .sekundar{background:#fff;color:#0460a7}' +
      '#mal-verktoy .panel{margin-top:10px;padding-top:10px;border-top:1px solid #d7e6f1}' +
      '#mal-verktoy textarea{width:100%;box-sizing:border-box;min-height:70px;font:11pt/1.4 Lato,Arial,sans-serif;padding:6px 8px;' +
      'border:1px solid #b6c2cc;border-radius:5px}' +
      '#mal-verktoy .hint{font-size:10.5pt;color:#5b6b75}' +
      '.mal-merke{float:right;margin-left:6px;font-size:13px;cursor:help}' +
      '.mal-rad-knapp{float:right;margin-left:6px;border:1px solid #b6c2cc;background:#fff;border-radius:4px;font-size:12px;' +
      'line-height:1;padding:2px 5px;cursor:pointer;opacity:.35}' +
      'td:hover > .mal-rad-knapp,.mal-rad-knapp:focus{opacity:1}';
    document.head.appendChild(st);
  }
  const send = (melding) => chrome.runtime.sendMessage({ action: 'malside-handling', kursId: status.kursId, ...melding });
  const boks = document.createElement('div');
  boks.id = 'mal-verktoy';
  const el = (tag, attr = {}, tekst) => {
    const e = document.createElement(tag);
    Object.entries(attr).forEach(([k, v]) => e.setAttribute(k, v));
    if (tekst != null) e.textContent = tekst;
    return e;
  };
  boks.appendChild(el('div', { style: 'font-weight:bold;margin-bottom:4px' }, '🈁 Nynorsk på denne malsiden'));

  if (!status.nnKolonne) {
    boks.appendChild(el('div', { class: 'hint', style: 'margin-bottom:8px' },
      'Malsiden har ikke kolonnen «Nynorsk» ennå. Utvidelsen legger den inn rett etter Bokmål og oversetter malene.'));
    const k = el('button', { class: 'hoved' }, 'Legg til Nynorsk-kolonnen og oversett');
    k.onclick = () => { k.disabled = true; send({ type: 'kolonne' }); };
    boks.appendChild(k);
    tabell.parentNode.insertBefore(boks, tabell);
    return;
  }

  const t = status.tal;
  const deler = [`${t.oppdatert} oppdatert`];
  if (t.eldre) deler.push(`${t.eldre} med eldre ledetekst 🕘`);
  if (t.hand) deler.push(`${t.hand} rettet for hånd ✋`);
  if (t.mangler) deler.push(`${t.mangler} venter på oversettelse`);
  boks.appendChild(el('div', {}, deler.join(' · ')));
  boks.appendChild(el('div', { class: 'hint', style: 'margin:2px 0 8px 0' },
    'Endret bokmål oversettes automatisk når du lagrer siden. ↻ i en nynorsk-celle oversetter den malen på nytt med ledeteksten.'));

  const knappar = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
  const alleKnapp = el('button', { class: 'hoved' }, 'Oversett alle på nytt');
  const ltKnapp = el('button', { class: 'sekundar' }, 'Ledetekst ▾');
  knappar.append(alleKnapp, ltKnapp);
  boks.appendChild(knappar);

  // Ledetekst (felles for malsiden)
  const ltPanel = el('div', { class: 'panel', style: 'display:none' });
  ltPanel.appendChild(el('div', { style: 'font-weight:bold;margin-bottom:4px' }, 'Ledetekst til Copilot – gjelder hele malsiden'));
  const felt = el('textarea');
  felt.value = status.ledetekst;
  ltPanel.appendChild(felt);
  const ltKnappar = el('div', { style: 'display:flex;gap:8px;margin-top:6px;align-items:center' });
  const lagre = el('button', { class: 'hoved' }, 'Lagre ledetekst');
  const standard = el('button', { class: 'sekundar' }, 'Standard ↺');
  ltKnappar.append(lagre, standard);
  ltPanel.appendChild(ltKnappar);
  ltPanel.appendChild(el('div', { class: 'hint', style: 'margin-top:6px' },
    'Nynorsken som står der, endres ikke. Den nye ledeteksten brukes neste gang en mal oversettes – når du endrer en ' +
    'bokmålstekst, skriver en ny mal eller velger «Oversett alle på nytt».'));
  boks.appendChild(ltPanel);
  ltKnapp.onclick = () => {
    const vis = ltPanel.style.display === 'none';
    ltPanel.style.display = vis ? 'block' : 'none';
    ltKnapp.textContent = vis ? 'Ledetekst ▴' : 'Ledetekst ▾';
  };
  standard.onclick = () => { felt.value = status.standard; };
  lagre.onclick = () => { lagre.disabled = true; send({ type: 'ledetekst', tekst: felt.value }); };

  // Bekreftelse for «Oversett alle på nytt»
  const bekreft = el('div', { class: 'panel', style: 'display:none' });
  const tekst = el('div', { style: 'margin-bottom:6px' });
  bekreft.appendChild(tekst);
  let taMed = null;
  if (t.hand) {
    const etikett = el('label', { class: 'hint', style: 'display:block;margin-bottom:8px' });
    taMed = el('input', { type: 'checkbox', style: 'margin-right:6px' });
    etikett.append(taMed, `Ta med ${t.hand} ${t.hand === 1 ? 'mal' : 'maler'} rettet for hånd (✋) – rettelsene dine overskrives`);
    bekreft.appendChild(etikett);
  }
  const bk = el('div', { style: 'display:flex;gap:8px' });
  const ja = el('button', { class: 'hoved' });
  const nei = el('button', { class: 'sekundar' }, 'Avbryt');
  bk.append(ja, nei);
  bekreft.appendChild(bk);
  boks.appendChild(bekreft);
  const antal = () => status.antalBm - (taMed && taMed.checked ? 0 : t.hand);
  const oppdaterTekst = () => {
    const n = antal();
    tekst.textContent = `Oversette ${n} ${n === 1 ? 'mal' : 'maler'} på nytt med ledeteksten? Copilot lager ny nynorsk for hele malen – ` +
      'også ord du var fornøyd med, kan bli endret. Forrige versjon finnes i sidens historikk i Canvas.';
    ja.textContent = `Oversett ${n} på nytt`;
  };
  if (taMed) taMed.onchange = oppdaterTekst;
  alleKnapp.onclick = () => { oppdaterTekst(); bekreft.style.display = 'block'; };
  nei.onclick = () => { bekreft.style.display = 'none'; };
  ja.onclick = () => { ja.disabled = true; send({ type: 'alle', taMedHand: !!(taMed && taMed.checked) }); };

  tabell.parentNode.insertBefore(boks, tabell);

  // Merker og ↻ i nynorsk-cellene
  const kol = finnKolonnar(tabell);
  if (kol.nn < 0) return;
  dataRader(tabell).forEach((tr, i) => {
    const m = status.merker[i];
    const celle = cellerIRad(tr)[kol.nn];
    if (!m || !celle || !m.kan) return;
    const knapp = el('button', { class: 'mal-rad-knapp', title: 'Oversett denne malen på nytt med malsidens ledetekst' }, '↻');
    knapp.onclick = () => {
      if (m.hand && !confirm('Du har rettet denne nynorsken for hånd. Oversette malen på nytt og overskrive rettelsen?')) return;
      knapp.disabled = true;
      send({ type: 'rad', rad: i });
    };
    celle.prepend(knapp);
    if (m.hand) celle.prepend(el('span', { class: 'mal-merke', title: 'Rettet for hånd – røres ikke av «Oversett alle på nytt»' }, '✋'));
    else if (m.eldre) celle.prepend(el('span', { class: 'mal-merke', title: 'Oversatt med en eldre ledetekst' }, '🕘'));
  });

  // Etter omlasting: rull til raden(e) som nettopp ble oversatt og uthev dem kort,
  // eller til verktøylinja (etter ny ledetekst / «Oversett alle på nytt»)
  if (status.rullTil === 'verktøy') {
    boks.scrollIntoView({ block: 'start' });
  } else if (Array.isArray(status.rullTil) && status.rullTil.length) {
    const rader = dataRader(tabell);
    const merk = status.rullTil.map(i => rader[i]).filter(Boolean);
    if (merk.length) {
      merk[0].scrollIntoView({ block: 'center' });
      merk.forEach((tr) => {
        cellerIRad(tr).forEach((c) => {
          c.style.transition = 'background-color 1.5s';
          c.style.backgroundColor = '#fff4c2';
        });
        setTimeout(() => cellerIRad(tr).forEach((c) => { c.style.backgroundColor = ''; }), 3500);
      });
    }
  }
}

// Handlinger fra verktøylinja på malsiden
async function malsideHandling(melding, tabId) {
  const { kurs = [] } = await chrome.storage.local.get('kurs');
  const k = kurs.find(x => x.kursId === melding.kursId);
  if (!k || !tabId) return { feil: 'Fant ikke faget.' };
  let res;
  if (melding.type === 'ledetekst') {
    const side = await iKanvas(tabId, lesMalside, [k.url]);
    if (!side || side.feil) res = { feil: side?.feil || 'Kunne ikke lese malsiden.' };
    else res = await iKanvas(tabId, skrivMalside, [k.url, side.oppdatert, {}, { ledetekst: melding.tekst }]);
    await visMelding(tabId, res?.ok ? '✓ Ledeteksten er lagret for malsiden.' : '⚠ ' + (res?.feil || 'Lagringen feilet.'),
      res?.ok ? 'ok' : 'feil', 2500);
  } else if (melding.type === 'alle') {
    res = await oppdaterNynorsk(k.kursId, { tabId, melding: true, modus: 'alle', taMedHand: !!melding.taMedHand });
  } else if (melding.type === 'rad') {
    res = await oppdaterNynorsk(k.kursId, { tabId, melding: true, rader: [melding.rad] });
  } else if (melding.type === 'kolonne') {
    res = await oppdaterNynorsk(k.kursId, { tabId, melding: true });
  }
  if (res?.ok) {
    sistAuto.set(tabId, Date.now());
    lastMalsidePåNytt(tabId, k, melding.type === 'ledetekst' ? 1200 : 2500,
      melding.type === 'rad' ? [melding.rad] : 'verktøy');
  } else if (res?.feil && !res.pågår) {
    await visVerktøy(tabId, k);  // tegn verktøylinja på nytt så knappene virker igjen
  }
  return res;
}

// ─── HOVEDLØP ────────────────────────────────────────────────────────────────

async function settInnMal(nynorsk = false) {
  if (innsettingAktiv) return { feil: 'Innsetting pågår allerede' };
  innsettingAktiv = true;
  let tabId = null;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('speed_grader')) return { feil: 'Ikke SpeedGrader' };
    tabId = tab.id;

    // Les kursnummer frå Speed Grader-URL
    const kursMatch = tab.url.match(/\/courses\/(\d+)\//);
    if (!kursMatch) return await feilmelding(tabId, 'Kunne ikke lese fagnummer fra URL-en');
    const aktivtKursId = kursMatch[1];
    const oppgaveId = new URL(tab.url).searchParams.get('assignment_id');

    // Finn rett mal-URL for dette kurset
    const storage = await chrome.storage.local.get('kurs');
    const kurs = (storage.kurs || []).find(k => k.kursId === aktivtKursId);
    if (!kurs) return await feilmelding(tabId, 'Ingen malside er lagret for dette faget. Legg den til i utvidelsen.');

    const info = await hentElevinfo(tabId);
    if (!info?.fornavn) return await feilmelding(tabId, 'Fant ikke elevnavnet');

    let malRes = await hentMal(tabId, kurs.url, info.tittel, info.csrfToken, oppgaveId);
    if (!malRes?.mal) return await feilmelding(tabId, malRes?.feil || 'Fant ingen mal');

    let malHtml = malRes.mal;
    let fråMalside = false;
    if (nynorsk && !malRes.nnGyldig && malRes.nnKolonne) {
      // Malsiden har Nynorsk-kolonne, men denne malen mangler nynorsk eller bokmål
      // er endret: oppdater malsiden først (varsel vises), og sett inn derfra.
      await visMelding(tabId, '🔄 Malsiden er endret – oppdaterer nynorsk før innsetting …', 'info', 0);
      const opp = await oppdaterNynorsk(aktivtKursId, { tabId, melding: true, auto: true });
      if (opp.ok) {
        const ny = await hentMal(tabId, kurs.url, info.tittel, info.csrfToken, oppgaveId);
        if (ny?.nnGyldig) malRes = ny;
      }
    }
    if (nynorsk && malRes.nnGyldig) {
      // Nynorsk ligger ferdig i kolonne 3 på malsiden – ingen Copilot
      malHtml = malRes.nn;
      fråMalside = true;
    } else if (nynorsk) {
      const oms = await omsettMedCopilot({
        kursId: aktivtKursId, tittel: info.tittel, mal: malRes.mal,
        speedgraderTabId: tabId, ledetekst: malRes.ledetekst
      });
      if (oms.feil) return oms;  // meldingen er alt vist
      malHtml = oms.html;
    }

    const res = await settInnIEditor(tabId, malHtml, info.fornavn);
    if (res.feil) return await feilmelding(tabId, res.feil);
    if (fråMalside) await visMelding(tabId, '✓ Nynorsk mal fra malsiden satt inn', 'ok', 2000);
    else if (nynorsk && malRes.nn) {
      await visMelding(tabId, '✓ Nynorsk satt inn (Copilot). Nynorsken på malsiden er utdatert – trykk 🔄 i utvidelsen.', 'ok', 6000);
    } else if (nynorsk) await visMelding(tabId, '✓ Nynorsk mal satt inn', 'ok', 2500);
    return res;

  } finally {
    innsettingAktiv = false;
  }
}

async function feilmelding(tabId, tekst) {
  await visMelding(tabId, '⚠ ' + tekst, 'feil', 6000);
  return { feil: tekst };
}

// Reserve fra popupen: læreren har limt inn Copilots svar for hånd.
// Sjekker at det er samme oppgave og at @fornavn er i behold, husker svaret
// og setter det inn for eleven som er valgt nå.
async function settInnManuell(html) {
  const { ventande } = await chrome.storage.session.get('ventande');
  if (!ventande) return { feil: 'Ingen oversettelse venter.' };

  const tab = await chrome.tabs.get(ventande.speedgraderTabId).catch(() => null);
  if (!tab || !tab.url.includes('speed_grader')) return { feil: 'Fant ikke SpeedGrader-fanen. Prøv på nytt fra SpeedGrader.' };

  const sjekk = sjekkFornavn(ventande.mal, html);
  if (!sjekk.ok) return sjekk;

  const info = await hentElevinfo(tab.id);
  if (!info?.fornavn) return { feil: 'Fant ikke elevnavnet' };
  if (info.tittel !== ventande.tittel) {
    return { feil: `SpeedGrader viser en annen oppgave («${info.tittel}») enn den som skulle oversettes («${ventande.tittel}»).` };
  }

  const res = await settInnIEditor(tab.id, html, info.fornavn);
  if (res.ok) {
    await chrome.storage.session.set({ [ventande.nokkel]: html });
    await chrome.storage.session.remove('ventande');
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  }
  return res;
}
