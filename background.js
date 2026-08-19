let innsettingAktiv = false;

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

// ─── OVERSETT TIL NYNORSK (Apertium – gratis, ingen nøkkel) ──────────────────
// Apertium med format=html omset teksten, men held HTML-taggane. Fetch skjer
// frå service-workaren (host_permissions), så CORS er ikkje eit problem.
async function oversettMedApertium(html) {
  // «fornavn» er bokmål (nynorsk: «fornamn»), så Apertium ville omsett sjølve
  // plasshaldaren. Vern han med ein nøytral markør og gjenopprett etterpå.
  const MARKOR = 'PLACEHOLDERNAME';
  const beskytta = html.replace(/@fornavn/gi, MARKOR);

  try {
    const body = new URLSearchParams({
      langpair: 'nob|nno_e', // e-infinitiv + «vi» (mindre traust enn standard nob|nno)
      q: beskytta,
      format: 'html',
      markUnknown: 'no'
    });
    const res = await fetch('https://apertium.org/apy/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!res.ok) {
      return { feil: `Apertium svarte HTTP ${res.status}. Prøv igjen om litt.` };
    }
    const data = await res.json();
    let ut = data?.responseData?.translatedText;
    if (typeof ut !== 'string' || !ut.trim()) {
      return { feil: 'Tomt eller uventa svar frå Apertium' };
    }
    // Gjenopprett plasshaldaren (markøren er ukjend for Apertium og passerer uendra)
    ut = ut.replace(new RegExp(MARKOR, 'gi'), '@fornavn');
    return { tekst: ut };
  } catch (e) {
    return { feil: 'Apertium feila: ' + e.message };
  }
}

async function settInnMal(oversett = false) {
  if (innsettingAktiv) return { feil: 'Innsetting pågår allereie' };
  innsettingAktiv = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('speed_grader')) return { feil: 'Ikkje Speed Grader' };

    // Les kursnummer frå Speed Grader-URL
    const kursMatch = tab.url.match(/\/courses\/(\d+)\//);
    if (!kursMatch) return { feil: 'Kunne ikkje lese kursnummer frå URL' };
    const aktivtKursId = kursMatch[1];

    // Finn rett mal-URL for dette kurset
    const storage = await chrome.storage.local.get('kurs');
    const kursliste = storage.kurs || [];
    const kurs = kursliste.find(k => k.kursId === aktivtKursId);

    if (!kurs) return { feil: `Ingen mal-URL lagra for dette kurset. Legg til URL i utvidelsen.` };

    // Hent elevinfo
    const infoResultat = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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

    const info = infoResultat?.[0]?.result;
    if (!info?.fornavn) return { feil: 'Fann ikkje elevnamn' };

    // Hent mal frå rett Canvas-side
    const malResultat = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (malUrl, oppgavetittel, csrfToken) => {
        try {
          const match = malUrl.match(/\/courses\/(\d+)\/pages\/([^/?#]+)/);
          if (!match) return { feil: 'Ugyldig Canvas-URL' };
          const res = await fetch(`/api/v1/courses/${match[1]}/pages/${match[2]}`, {
            headers: { 'Accept': 'application/json', 'X-CSRF-Token': csrfToken }
          });
          if (!res.ok) return { feil: `Kunne ikkje hente sida: HTTP ${res.status}` };
          const data = await res.json();
          const parser = new DOMParser();
          const doc = parser.parseFromString(data.body, 'text/html');
          const datarader = Array.from(doc.querySelectorAll('table tr')).slice(1);
          let funnetMal = null;
          for (const rad of datarader) {
            const celler = rad.querySelectorAll('td');
            if (celler.length >= 2 && celler[0].textContent.trim() === oppgavetittel) {
              funnetMal = celler[1].innerHTML; break;
            }
          }
          if (!funnetMal) return { feil: `Ingen mal funne for denne oppgåva.` };
          return { mal: funnetMal };
        } catch (e) { return { feil: e.message }; }
      },
      args: [kurs.url, info.tittel, info.csrfToken]
    });

    const malRes = malResultat?.[0]?.result;
    if (!malRes?.mal) return { feil: malRes?.feil || 'Fann ingen mal' };

    // Oversett til nynorsk om ønska (før @fornavn blir bytt ut)
    let malHtml = malRes.mal;
    if (oversett) {
      const oms = await oversettMedApertium(malHtml);
      if (oms.feil) return { feil: oms.feil };
      malHtml = oms.tekst;
    }

    // Sett inn i editor
    const innSettingResultat = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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
              resolve({ ok: false, feil: 'Tidsavbrot: editor ikkje klar innan 15 sekund' });
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
      args: [malHtml, info.fornavn]
    });

    const innSettingRes = innSettingResultat?.[0]?.result;
    if (!innSettingRes?.ok) return { feil: innSettingRes?.feil || 'Innsetting mislyktes' };
    return { ok: true };

  } finally {
    innsettingAktiv = false;
  }
}
