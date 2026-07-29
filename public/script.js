// clickcheck frontend
// sends the url to my own backend (/api/check) - the api keys never
// come to the browser. also keeps the scan history in localStorage
// and handles the search / filter / sort controls

const els = {
  input: document.getElementById('url-input'),
  scanBtn: document.getElementById('scan-btn'),
  formError: document.getElementById('form-error'),
  verdict: document.getElementById('verdict'),
  historyBody: document.getElementById('history-body'),
  historyEmpty: document.getElementById('history-empty'),
  search: document.getElementById('history-search'),
  filter: document.getElementById('history-filter'),
  sort: document.getElementById('history-sort'),
  clear: document.getElementById('clear-history'),
  servedBy: document.getElementById('served-by'),
};

const STORAGE_KEY = 'clickcheck-history';

// history lives in localStorage so it survives a page refresh

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
}

// runs when you press scan (or enter)

async function scan() {
  const url = els.input.value.trim();
  hideError();

  if (!url) {
    showError('Please paste a link first.');
    return;
  }

  els.scanBtn.disabled = true;
  els.scanBtn.textContent = 'Scanning…';
  els.verdict.hidden = true;

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'The scan failed. Please try again.');
      return;
    }

    renderVerdict(data);

    const items = loadHistory();
    items.unshift({
      url: data.url,
      verdict: data.verdict,
      score: data.score,
      checkedAt: data.checkedAt,
    });
    saveHistory(items);
    renderHistory();

    if (data.servedBy) {
      els.servedBy.textContent = `This request was handled by: ${data.servedBy}`;
    }
  } catch {
    showError('Could not reach the server. Check your connection and try again.');
  } finally {
    els.scanBtn.disabled = false;
    els.scanBtn.textContent = 'Scan link';
  }
}

// what to say for each verdict

const VERDICT_COPY = {
  safe: {
    title: 'Looks safe',
    advice: 'No security engine flagged this link. Still, never share passwords or PINs unless you are sure who is asking.',
  },
  suspicious: {
    title: 'Suspicious — be careful',
    advice: 'Some engines flagged this link as suspicious. Avoid entering personal information or downloading files from it.',
  },
  dangerous: {
    title: 'Dangerous — do not open',
    advice: 'This link is flagged as phishing or malware. Do not open it, and warn whoever sent it to you.',
  },
};

function renderVerdict(data) {
  const copy = VERDICT_COPY[data.verdict];
  const gsb = data.sources.googleSafeBrowsing;
  const vt = data.sources.virusTotal;

  const details = [];
  if (gsb.available) {
    details.push(
      gsb.flagged
        ? `Google Safe Browsing: flagged (${gsb.threats.join(', ')})`
        : 'Google Safe Browsing: no threats found'
    );
  } else {
    details.push(`Google Safe Browsing: unavailable — ${gsb.error}`);
  }
  if (vt.available) {
    details.push(
      `VirusTotal: ${vt.malicious} malicious, ${vt.suspicious} suspicious out of ${vt.totalEngines} engines`
    );
  } else {
    details.push(`VirusTotal: unavailable — ${vt.error}`);
  }

  els.verdict.className = `verdict ${data.verdict}`;
  els.verdict.innerHTML = `
    <div class="verdict-inner">
      <div class="score-dial" style="--pct:${data.score}">
        <div class="dial-center">${data.score}</div>
      </div>
      <div class="verdict-text">
        <p class="verdict-title">${copy.title}</p>
        <p class="verdict-url"></p>
        <ul class="verdict-detail">
          ${details.map(() => '<li></li>').join('')}
        </ul>
      </div>
    </div>
    <p class="verdict-advice">${copy.advice}</p>
  `;

  // put the url and details in with textContent not innerHTML,
  // so a weird url can't inject html into my page (xss)
  els.verdict.querySelector('.verdict-url').textContent = data.url;
  els.verdict
    .querySelectorAll('.verdict-detail li')
    .forEach((li, i) => (li.textContent = details[i]));

  els.verdict.hidden = false;
}

function renderHistory() {
  const query = els.search.value.trim().toLowerCase();
  const filter = els.filter.value;
  const sort = els.sort.value;

  let items = loadHistory();

  // search box
  if (query) items = items.filter((i) => i.url.toLowerCase().includes(query));
  // verdict dropdown
  if (filter !== 'all') items = items.filter((i) => i.verdict === filter);
  // sort dropdown
  const sorters = {
    newest: (a, b) => new Date(b.checkedAt) - new Date(a.checkedAt),
    oldest: (a, b) => new Date(a.checkedAt) - new Date(b.checkedAt),
    'risk-high': (a, b) => b.score - a.score,
    'risk-low': (a, b) => a.score - b.score,
  };
  items.sort(sorters[sort]);

  els.historyBody.innerHTML = '';
  els.historyEmpty.hidden = items.length > 0;

  for (const item of items) {
    const tr = document.createElement('tr');

    const urlTd = document.createElement('td');
    urlTd.className = 'url-cell';
    urlTd.textContent = item.url;
    urlTd.title = item.url;

    const verdictTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${item.verdict}`;
    badge.textContent = item.verdict;
    verdictTd.appendChild(badge);

    const scoreTd = document.createElement('td');
    scoreTd.textContent = `${item.score}/100`;

    const dateTd = document.createElement('td');
    dateTd.textContent = new Date(item.checkedAt).toLocaleString();

    tr.append(urlTd, verdictTd, scoreTd, dateTd);
    els.historyBody.appendChild(tr);
  }
}

// small error message under the input

function showError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

function hideError() {
  els.formError.hidden = true;
}

// hook up all the buttons and inputs

els.scanBtn.addEventListener('click', scan);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') scan();
});
els.search.addEventListener('input', renderHistory);
els.filter.addEventListener('change', renderHistory);
els.sort.addEventListener('change', renderHistory);
els.clear.addEventListener('click', () => {
  if (confirm('Delete all scan history on this device?')) {
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
  }
});

renderHistory();

