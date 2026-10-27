// Vis kursliste ved oppstart
lastKursliste();

async function lastKursliste() {
  const data = await chrome.storage.local.get('kurs');
  const kurs = data.kurs || [];
  visKursliste(kurs);
}

function visKursliste(kurs) {
  const liste = document.getElementById('kursliste');
  liste.innerHTML = '';

  if (kurs.length === 0) {
    liste.innerHTML = '<div class="ingen-kurs">Ingen fag lagret ennå.</div>';
    return;
  }

  // Hvert kurs vises med navn og hele URL-en under. URL-en er en lenke
  // (åpner malsiden i ny fane), kan merkes med musa og har egen kopier-knapp.
  // Bygges med DOM i stedet for innerHTML, så URL-en aldri tolkes som HTML.
  kurs.forEach((k, idx) => {
    const rad = document.createElement('div');
    rad.className = 'kurs-rad';

    const tekst = document.createElement('div');
    tekst.className = 'kurs-tekst';
    const namn = document.createElement('div');
    namn.className = 'kurs-namn';
    namn.textContent = '📄 ' + k.namn;
    const lenke = document.createElement('a');
    lenke.className = 'kurs-url';
    lenke.href = k.url;
    lenke.target = '_blank';
    lenke.textContent = k.url;
    tekst.append(namn, lenke);

    const kopier = document.createElement('button');
    kopier.className = 'kurs-kopier';
    kopier.title = 'Kopier URL';
    kopier.textContent = '📋';
    kopier.addEventListener('click', () => kopierUrl(k.url, kopier));

    // Malsiden er arbeidsstedet for nynorsken: åpne den i ny fane
    const opne = document.createElement('button');
    opne.className = 'kurs-kopier';
    opne.title = 'Åpne malsiden';
    opne.textContent = '↗';
    opne.addEventListener('click', () => chrome.tabs.create({ url: k.url }));

    const slett = document.createElement('button');
    slett.className = 'kurs-slett';
    slett.dataset.idx = idx;
    slett.title = 'Slett';
    slett.textContent = '✕';

    rad.append(tekst, kopier, opne, slett);
    liste.appendChild(rad);
  });

  liste.querySelectorAll('.kurs-slett').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      const data = await chrome.storage.local.get('kurs');
      const kurs = data.kurs || [];
      kurs.splice(idx, 1);
      await chrome.storage.local.set({ kurs });
      visKursliste(kurs);
    });
  });
}

// Kopier URL til utklippstavla; gir kort bekreftelse på knappen
async function kopierUrl(url, knapp) {
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    // Reserve: merk teksten i et skjult felt og kopier
    const felt = document.createElement('textarea');
    felt.value = url;
    document.body.appendChild(felt);
    felt.select();
    document.execCommand('copy');
    felt.remove();
  }
  const før = knapp.textContent;
  knapp.textContent = '✓';
  setTimeout(() => { knapp.textContent = før; }, 1200);
}

// ─── BEKREFTELSE I POPUPEN ───────────────────────────────────────────────────
// Erstatter confirm(): nettleserens egen dialog vises ikke alltid i en utvidelses-
// popup (sett i Chrome 26.10.2026 – malsiden ble laget uten spørsmål). Boksen står
// under «Lagrede fag» og venter på «Ja» eller «Avbryt».
function spør(tekst, jaTekst) {
  const boks = document.getElementById('bekreft');
  const ja = document.getElementById('bekreft-ja');
  const nei = document.getElementById('bekreft-nei');
  document.getElementById('bekreft-tekst').textContent = tekst;
  ja.textContent = jaTekst;
  boks.style.display = 'block';
  boks.scrollIntoView({ block: 'nearest' });
  nei.focus();
  return new Promise((svar) => {
    const ferdig = (v) => { boks.style.display = 'none'; ja.onclick = nei.onclick = null; svar(v); };
    ja.onclick = () => ferdig(true);
    nei.onclick = () => ferdig(false);
  });
}

// ─── LAG MALSIDE FRÅ MODULANE ────────────────────────────────────────────────
// Faget i den aktive fanen. Ny malside, eller påfyll av innleveringer som
// mangler i en eksisterende malside. Viser først hva som vil skje.
document.getElementById('lag-malside').addEventListener('click', async () => {
  const el = document.getElementById('malside-status');
  el.style.color = '#555';
  el.innerHTML = '<span class="spinner"></span>Leser modulene…';
  const r = await chrome.runtime.sendMessage({ action: 'malside-plan' });
  if (!r?.plan) { el.style.color = 'red'; el.textContent = '⚠ ' + (r?.feil || 'Ukjent feil'); return; }
  const p = r.plan;
  let spørsmål;
  if (p.ny) {
    spørsmål = `Lage ny malside «${p.tittel}» med ${p.antal} innleveringer fra modulene?\n\n` +
      'Siden blir upublisert (bare lærere ser den) og legges til i utvidelsen.';
  } else if (p.endringar === undefined) {
    // Svar fra en eldre bakgrunnsdel (Chrome har ikke lastet utvidelsen helt på nytt)
    el.style.color = 'red';
    el.textContent = '⚠ Utvidelsen er ikke lastet helt på nytt – klikk ↻ på utvidelsen i chrome://extensions og prøv igjen.';
    return;
  } else if (!p.endringar) {
    el.style.color = 'green';
    el.textContent = `✓ Malsiden for «${p.namn}» er i takt med modulene (${p.antal} innleveringer).`;
    return;
  } else {
    const t = p.tal;
    const linjer = [
      t.nye && `· ${t.nye} nye innleveringer legges til på riktig plass`,
      t.omdøypt && `· ${t.omdøypt} oppgaver har fått nytt navn – tittelen oppdateres`,
      t.kopla && `· ${t.kopla} rader kobles til oppgaven sin (lenke)`,
      t.borte && `· ${t.borte} oppgaver finnes ikke lenger i modulene – raden merkes ⚠ (slettes ikke)`,
      t.tilbake && `· ${t.tilbake} oppgaver er tilbake i modulene – ⚠-merket fjernes`
    ].filter(Boolean).join('\n');
    spørsmål = `Oppdatere malsiden for «${p.namn}» fra modulene?\n\n${linjer}\n\nBokmål og nynorsk røres ikke.`;
  }
  el.textContent = '';
  if (!(await spør(spørsmål, p.ny ? 'Lag siden' : 'Oppdater'))) { el.textContent = 'Avbrutt – ingenting er endret.'; return; }
  el.innerHTML = '<span class="spinner"></span>' + (p.ny ? 'Lager malsiden…' : 'Oppdaterer malsiden…');
  const res = await chrome.runtime.sendMessage({ action: 'malside-lag' });
  if (!res?.ok) { el.style.color = 'red'; el.textContent = '⚠ ' + (res?.feil || 'Ukjent feil'); return; }
  el.style.color = 'green';
  el.textContent = res.ny ? `✓ Malsiden er laget med ${res.antal} innleveringer og åpnet i fanen.`
    : `✓ Malsiden er oppdatert fra modulene.`;
  lastKursliste();
});

// Legg til ny URL
document.getElementById('lagre').addEventListener('click', async () => {
  const urlInput = document.getElementById('url');
  const status = document.getElementById('legg-til-status');
  const url = urlInput.value.trim();

  if (!url) {
    status.style.color = 'orange';
    status.textContent = '⚠ Lim inn en URL først.';
    return;
  }

  const match = url.match(/\/courses\/(\d+)\//);
  if (!match) {
    status.style.color = 'orange';
    status.textContent = '⚠ URL-en ser ikke ut som en Canvas-side.';
    return;
  }

  const kursId = match[1];

  // Sjekk duplikat
  const eksisterande = await chrome.storage.local.get('kurs');
  const kursliste = eksisterande.kurs || [];
  if (kursliste.some(k => k.kursId === kursId)) {
    status.style.color = 'orange';
    status.textContent = '⚠ Dette faget er allerede lagret.';
    return;
  }

  status.innerHTML = '<span class="spinner"></span>Henter fagnavn…';
  status.style.color = '#555';

  const result = await chrome.runtime.sendMessage({ action: 'hent-kursnamn', kursId });

  if (!result?.namn) {
    status.style.color = 'red';
    status.textContent = '⚠ ' + (result?.feil || 'Kunne ikke hente fagnavn.');
    return;
  }

  kursliste.push({ kursId, url, namn: result.namn });
  await chrome.storage.local.set({ kurs: kursliste });

  urlInput.value = '';
  status.style.color = 'green';
  status.textContent = `✓ «${result.namn}» lagret!`;
  visKursliste(kursliste);
});

// Set inn mal
document.getElementById('btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.innerHTML = '<span class="spinner"></span>Henter mal…';
  statusEl.style.color = '#555';
  const result = await chrome.runtime.sendMessage({ action: 'sett-inn-mal' });
  statusEl.style.color = result?.ok ? 'green' : 'red';
  statusEl.textContent = result?.ok ? '✓ Mal sett inn!' : ('⚠ ' + (result?.feil || 'Ukjent feil'));
});

// Set inn mal omsett til nynorsk via Copilot
document.getElementById('btn-nynorsk').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.innerHTML = '<span class="spinner"></span>Henter nynorsk mal…';
  statusEl.style.color = '#555';
  const result = await chrome.runtime.sendMessage({ action: 'sett-inn-mal-nynorsk' });
  statusEl.style.color = result?.ok ? 'green' : 'red';
  statusEl.textContent = result?.ok ? '✓ Nynorsk-mal sett inn!' : ('⚠ ' + (result?.feil || 'Ukjent feil'));
  if (result?.reserve) visReserve();
});

// ─── RESERVE: FULLFØR FOR HÅND ───────────────────────────────────────────────
// Vises når automatikken mot Copilot feilet (ikke innlogget, endret side,
// @fornavn endret). Teksten til Copilot ligger i chrome.storage.session.

async function visReserve() {
  const { ventande } = await chrome.storage.session.get('ventande');
  const boks = document.getElementById('reserve');
  if (!ventande) { boks.style.display = 'none'; return; }
  boks.style.display = 'block';
  document.getElementById('reserve-grunn').textContent =
    `Oppgave: «${ventande.tittel}». Grunn: ${ventande.grunn || 'ukjent'}`;
}
visReserve();

document.getElementById('reserve-kopier').addEventListener('click', async () => {
  const { ventande } = await chrome.storage.session.get('ventande');
  if (!ventande) return;
  await kopierUrl(ventande.prompt, document.getElementById('reserve-kopier'));
  document.getElementById('reserve-status').textContent = '✓ Kopiert – lim inn i Copilot (⌘V) og trykk Send.';
});

document.getElementById('reserve-set-inn').addEventListener('click', async () => {
  const statusEl = document.getElementById('reserve-status');
  statusEl.style.color = '#b3261e';  // feil vises tydelig i rødt
  const tekst = document.getElementById('reserve-svar').value;
  if (!tekst.trim()) { statusEl.textContent = '⚠ Lim inn svaret fra Copilot først.'; return; }
  // Svaret («[1] …»-linjene) bygges inn i original-malen med samme merke-metode
  // som automatikken, så bilder, film og formatering blir med.
  const { ventande } = await chrome.storage.session.get('ventande');
  if (!ventande) { statusEl.textContent = '⚠ Ingen oversettelse venter.'; return; }
  const bygd = delOgBygg(ventande.mal, tekst);
  if (bygd.avvik) {
    statusEl.textContent = '⚠ Svaret passer ikke til malen: ' + bygd.avvik.slice(0, 2).join('; ') +
      '. Kopier hele svaret fra Copilot, med [1], [2] … og merkene.';
    return;
  }
  statusEl.style.color = '#555';
  statusEl.innerHTML = '<span class="spinner"></span>Setter inn…';
  const result = await chrome.runtime.sendMessage({ action: 'sett-inn-manuell', html: bygd.html });
  if (result?.ok) {
    statusEl.textContent = '';
    document.getElementById('reserve-svar').value = '';
    document.getElementById('status').style.color = 'green';
    document.getElementById('status').textContent = '✓ Nynorsk-mal sett inn!';
    visReserve();
  } else {
    statusEl.style.color = '#b3261e';
    statusEl.textContent = '⚠ ' + (result?.feil || 'Ukjent feil');
  }
});

document.getElementById('reserve-avbryt').addEventListener('click', async () => {
  await chrome.storage.session.remove('ventande');
  visReserve();
});
