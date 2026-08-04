(function () {
  var ENDPOINT = '/api/contact';
  // Every site form: contact, service quote, and footer subscribe.
  var FORM_SELECTOR =
    '#ce-form-Contact-Form, #ce-form-Service-Form, #ce-form-Footer-Subscribe, form[data-name], .w-form form';

  function fieldValue(form, names) {
    for (var i = 0; i < names.length; i++) {
      var el = form.querySelector('[name="' + names[i] + '"]');
      if (el && el.value) return el.value.trim();
    }
    return '';
  }

  function getTurnstileToken(form) {
    if (window.jQuery) {
      var state = window.jQuery(form).data('w-form');
      if (state && state.turnstileToken) return state.turnstileToken;
    }
    var input = form.querySelector(
      'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
    );
    return input && input.value ? input.value.trim() : '';
  }

  function setLoading(form, loading) {
    var btn = form.querySelector('input[type="submit"], button[type="submit"]');
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.ceLabel) btn.dataset.ceLabel = btn.value || btn.textContent;
      var wait = btn.getAttribute('data-wait') || 'Please wait...';
      if (btn.tagName === 'INPUT') btn.value = wait;
      else btn.textContent = wait;
      btn.disabled = true;
    } else {
      if (btn.dataset.ceLabel) {
        if (btn.tagName === 'INPUT') btn.value = btn.dataset.ceLabel;
        else btn.textContent = btn.dataset.ceLabel;
      }
      btn.disabled = !getTurnstileToken(form);
    }
  }

  function showResult(form, ok) {
    var wrap = form.closest('.w-form');
    if (!wrap) return;
    var done = wrap.querySelector('.w-form-done');
    var fail = wrap.querySelector('.w-form-fail');
    form.style.display = ok ? 'none' : '';
    if (done) done.style.display = ok ? 'block' : 'none';
    if (fail) fail.style.display = ok ? 'none' : 'block';
    if (ok && done) done.focus();
    if (!ok && fail) fail.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    var form = event.currentTarget;
    var token = getTurnstileToken(form);
    if (!token) {
      showResult(form, false);
      return;
    }

    var formName =
      form.getAttribute('data-name') || form.getAttribute('name') || 'Contact Form';
    var email = fieldValue(form, [
      'Email',
      'email',
      'Footer-Email-2',
      'Footer-Email',
      'Email-2',
    ]);

    var payload = {
      name: fieldValue(form, ['Name', 'name', 'Full-Name', 'Full Name']),
      email: email,
      phone: fieldValue(form, ['Phone', 'phone', 'Phone-Number']),
      subject: fieldValue(form, ['Subject', 'subject']),
      message: fieldValue(form, ['Message', 'message']),
      formName: formName,
      turnstileToken: token,
    };

    setLoading(form, true);
    try {
      var res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json().catch(function () {
        return { ok: false };
      });
      showResult(form, res.ok && data.ok);
    } catch (err) {
      showResult(form, false);
    } finally {
      setLoading(form, false);
    }
  }

  function bind() {
    var seen = new WeakSet();
    document.querySelectorAll(FORM_SELECTOR).forEach(function (form) {
      if (seen.has(form)) return;
      seen.add(form);
      form.setAttribute('method', 'post');
      form.setAttribute('action', ENDPOINT);
      form.addEventListener('submit', handleSubmit, true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
