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
    liste.innerHTML = '<div class="ingen-kurs">Ingen kurs lagra enno.</div>';
    return;
  }

  kurs.forEach((k, idx) => {
    const rad = document.createElement('div');
    rad.className = 'kurs-rad';
    rad.innerHTML = `
      <span class="kurs-namn" title="${k.url}">📄 ${k.namn}</span>
      <button class="kurs-slett" data-idx="${idx}" title="Slett">✕</button>
    `;
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

// Legg til ny URL
document.getElementById('lagre').addEventListener('click', async () => {
  const urlInput = document.getElementById('url');
  const status = document.getElementById('legg-til-status');
  const url = urlInput.value.trim();

  if (!url) {
    status.style.color = 'orange';
    status.textContent = '⚠ Lim inn ein URL først.';
    return;
  }

  const match = url.match(/\/courses\/(\d+)\//);
  if (!match) {
    status.style.color = 'orange';
    status.textContent = '⚠ URL ser ikkje ut som ei Canvas-side.';
    return;
  }

  const kursId = match[1];

  // Sjekk duplikat
  const eksisterande = await chrome.storage.local.get('kurs');
  const kursliste = eksisterande.kurs || [];
  if (kursliste.some(k => k.kursId === kursId)) {
    status.style.color = 'orange';
    status.textContent = '⚠ Dette kurset er allereie lagra.';
    return;
  }

  status.innerHTML = '<span class="spinner"></span>Hentar kursnamn…';
  status.style.color = '#555';

  const result = await chrome.runtime.sendMessage({ action: 'hent-kursnamn', kursId });

  if (!result?.namn) {
    status.style.color = 'red';
    status.textContent = '⚠ ' + (result?.feil || 'Kunne ikkje hente kursnamn.');
    return;
  }

  kursliste.push({ kursId, url, namn: result.namn });
  await chrome.storage.local.set({ kurs: kursliste });

  urlInput.value = '';
  status.style.color = 'green';
  status.textContent = `✓ "${result.namn}" lagra!`;
  visKursliste(kursliste);
});

// Set inn mal
document.getElementById('btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.innerHTML = '<span class="spinner"></span>Hentar mal…';
  statusEl.style.color = '#555';
  const result = await chrome.runtime.sendMessage({ action: 'sett-inn-mal' });
  statusEl.style.color = result?.ok ? 'green' : 'red';
  statusEl.textContent = result?.ok ? '✓ Mal sett inn!' : ('⚠ ' + (result?.feil || 'Ukjent feil'));
});

// Set inn mal (omsett til nynorsk via Apertium)
document.getElementById('btn-nynorsk').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.innerHTML = '<span class="spinner"></span>Hentar mal og omset til nynorsk…';
  statusEl.style.color = '#555';
  const result = await chrome.runtime.sendMessage({ action: 'sett-inn-mal-nynorsk' });
  statusEl.style.color = result?.ok ? 'green' : 'red';
  statusEl.textContent = result?.ok ? '✓ Nynorsk-mal sett inn!' : ('⚠ ' + (result?.feil || 'Ukjent feil'));
});
