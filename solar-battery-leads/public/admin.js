(() => {
  const tokenInput = document.getElementById('token');
  const btnLoad = document.getElementById('btn-load');
  const filterGrade = document.getElementById('filter-grade');
  const rowsEl = document.getElementById('rows');
  const countEl = document.getElementById('count');
  const btnExport = document.getElementById('btn-export');

  const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'proposal-sent', 'closed-won', 'closed-lost'];

  let sort = 'score';
  let dir = 'desc';

  tokenInput.value = localStorage.getItem('admin_token') || '';

  function authHeaders() {
    return { Authorization: `Bearer ${tokenInput.value}` };
  }

  function fmtMoney(v) {
    if (!v) return '—';
    return `$${Number(v).toLocaleString()}`;
  }

  function renderRows(leads) {
    if (!leads.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" style="color:var(--text-dim);">No leads found.</td></tr>';
      return;
    }

    rowsEl.innerHTML = leads.map((lead) => `
      <tr>
        <td>${new Date(lead.created_at).toLocaleString()}</td>
        <td>${escapeHtml(lead.company_name)}</td>
        <td>${escapeHtml(lead.contact_name)}<br><span style="color:var(--text-dim)">${escapeHtml(lead.email)}</span></td>
        <td>${escapeHtml(lead.facility_type || '—')}<br><span style="color:var(--text-dim)">${escapeHtml(lead.city || '')} ${escapeHtml(lead.state || '')}</span></td>
        <td>${fmtMoney(lead.monthly_bill_usd)}</td>
        <td>${escapeHtml(lead.interest || '—')}</td>
        <td>${escapeHtml(lead.timeline || '—')}</td>
        <td><span class="grade-pill grade-${lead.grade}">${lead.score}</span></td>
        <td>
          <select data-id="${lead.id}" class="status-select">
            ${STATUS_OPTIONS.map((s) => `<option value="${s}" ${s === lead.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
      </tr>
    `).join('');

    rowsEl.querySelectorAll('.status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        await fetch(`/api/leads/${sel.dataset.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ status: sel.value }),
        });
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function load() {
    localStorage.setItem('admin_token', tokenInput.value);
    const params = new URLSearchParams({ sort, dir });
    if (filterGrade.value) params.set('grade', filterGrade.value);

    rowsEl.innerHTML = '<tr><td colspan="9">Loading…</td></tr>';
    const res = await fetch(`/api/leads?${params}`, { headers: authHeaders() });
    if (res.status === 401) {
      rowsEl.innerHTML = '<tr><td colspan="9" style="color:var(--danger)">Invalid admin token.</td></tr>';
      countEl.textContent = '';
      return;
    }
    const data = await res.json();
    renderRows(data.leads);
    countEl.textContent = `${data.leads.length} lead${data.leads.length === 1 ? '' : 's'}`;
  }

  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sort === col) {
        dir = dir === 'asc' ? 'desc' : 'asc';
      } else {
        sort = col;
        dir = 'desc';
      }
      load();
    });
  });

  btnLoad.addEventListener('click', load);
  filterGrade.addEventListener('change', load);

  btnExport.addEventListener('click', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/leads/export.csv', { headers: authHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  if (tokenInput.value) load();
})();
