(() => {
  const form = document.getElementById('lead-form');
  const steps = Array.from(form.querySelectorAll('.step'));
  const segs = Array.from(document.querySelectorAll('.progress .seg'));
  const btnBack = document.getElementById('btn-back');
  const btnNext = document.getElementById('btn-next');
  const btnSubmit = document.getElementById('btn-submit');
  const errorEl = document.getElementById('form-error');
  const successEl = document.getElementById('success');

  let current = 1;
  const choiceValues = {};

  document.querySelectorAll('.choice-grid').forEach((grid) => {
    const field = grid.dataset.field;
    grid.querySelectorAll('.choice').forEach((el) => {
      el.addEventListener('click', () => {
        grid.querySelectorAll('.choice').forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
        choiceValues[field] = el.dataset.value;
        errorEl.textContent = '';
      });
    });
  });

  function showStep(n) {
    steps.forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === n));
    segs.forEach((s) => s.classList.toggle('active', Number(s.dataset.seg) <= n));
    btnBack.disabled = n === 1;
    btnNext.style.display = n === steps.length ? 'none' : '';
    btnSubmit.style.display = n === steps.length ? '' : 'none';
    errorEl.textContent = '';
  }

  function validateStep(n) {
    if (n === 1) {
      const company = form.company_name.value.trim();
      const name = form.contact_name.value.trim();
      const email = form.email.value.trim();
      if (!company || !name || !email) return 'Please fill in company name, your name, and email.';
      if (!/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email address.';
    }
    return null;
  }

  btnNext.addEventListener('click', () => {
    const err = validateStep(current);
    if (err) {
      errorEl.textContent = err;
      return;
    }
    current = Math.min(current + 1, steps.length);
    showStep(current);
  });

  btnBack.addEventListener('click', () => {
    current = Math.max(current - 1, 1);
    showStep(current);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = validateStep(1);
    if (err) {
      current = 1;
      showStep(current);
      errorEl.textContent = err;
      return;
    }

    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    Object.assign(payload, choiceValues);
    payload.source = new URLSearchParams(location.search).get('utm_source') || 'website';

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting…';

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      form.style.display = 'none';
      document.querySelector('.progress').style.display = 'none';
      successEl.style.display = 'block';
    } catch (ex) {
      errorEl.textContent = ex.message;
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Get my quote';
    }
  });

  showStep(current);
})();
