/* Static design review only. No data is sent or persisted. */
(() => {
  const params = new URLSearchParams(location.search);
  let dirty = document.body.dataset.page === 'class';
  let secondPieceSaved = false;
  const railBreakpoint = matchMedia('(max-width: 1100px)');
  const mobileBreakpoint = matchMedia('(max-width: 760px)');
  const sidebarToggle = document.querySelector('.sidebar-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');

  function syncNavigation() {
    const mobile = mobileBreakpoint.matches;
    const collapsed = !mobile && (railBreakpoint.matches || document.body.classList.contains('nav-collapsed'));
    if (!mobile) document.body.classList.remove('nav-open');
    const mobileOpen = mobile && document.body.classList.contains('nav-open');
    const expanded = mobile ? mobileOpen : !collapsed;
    sidebarToggle.setAttribute('aria-expanded', String(expanded));
    sidebarToggle.setAttribute('aria-label', expanded ? 'Collapse navigation' : 'Expand navigation');
    sidebarToggle.title = expanded ? 'Collapse navigation' : 'Expand navigation';
    sidebarToggle.querySelector('[data-collapse-icon]').textContent = expanded ? 'chevron_left' : 'chevron_right';
    mobileMenu.setAttribute('aria-expanded', String(mobileOpen));
    mobileMenu.setAttribute('aria-label', mobileOpen ? 'Close navigation' : 'Open navigation');
    mobileMenu.title = mobileOpen ? 'Close navigation' : 'Open navigation';
  }

  railBreakpoint.addEventListener('change', syncNavigation);
  mobileBreakpoint.addEventListener('change', syncNavigation);
  syncNavigation();
  document.body.insertAdjacentHTML('beforeend', '<p class="preview-footer">Static design preview · Illustrative data · March 12, 2027</p>');
  const dialog = document.createElement('dialog');
  dialog.id = 'preview-dialog';
  dialog.setAttribute('aria-labelledby', 'preview-dialog-title');
  document.body.append(dialog);

  function showDialog(title, content) {
    dialog.innerHTML = `<div class="dialog-body"><h2 id="preview-dialog-title"></h2><div class="dialog-content"></div><div class="dialog-actions"><button class="button secondary" data-close-dialog>Close</button></div></div>`;
    dialog.querySelector('h2').textContent = title;
    if (typeof content === 'string') dialog.querySelector('.dialog-content').textContent = content;
    else dialog.querySelector('.dialog-content').append(content);
    dialog.showModal();
  }

  function toast(message) {
    document.querySelector('.toast')?.remove();
    const status = document.createElement('div');
    status.className = 'toast';
    status.setAttribute('role', 'status');
    status.textContent = message;
    document.body.append(status);
    setTimeout(() => status.remove(), 5000);
  }

  function showWaitlist() {
    const form = document.createElement('form');
    form.className = 'stack';
    form.innerHTML = `<p class="muted">Piano Ensemble · Leo Chen</p><p>This separate waitlist uses contact details and consent. It does not add a class to your cart.</p><label class="field">Parent name<input name="parentName" value="Jordan Chen" required></label><label class="field">Email<input name="parentEmail" type="email" value="jordan@example.com" required></label><label class="field">Phone<input name="parentPhone" type="tel" value="206-555-0142" required></label><label class="checkbox-field"><input type="checkbox" name="consent" required> I consent to festival staff using these contact details to manage my waitlist entry.</label><button class="button" type="submit">Join waitlist</button><p class="muted small">Static preview · nothing will be submitted.</p>`;
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
      toast('Waitlist confirmation preview. No entry was created.');
    });
    showDialog('Join the waitlist', form);
  }

  function updateCart() {
    const rows = [...document.querySelectorAll('[data-cart-item]')].filter(row => !row.hidden);
    const solo = rows.some(row => row.dataset.cartItem === 'solo');
    const concerto = rows.some(row => row.dataset.cartItem === 'concerto');
    const blocked = !solo && concerto;
    const warning = document.querySelector('#cart-warning');
    if (!warning) return;
    warning.hidden = !blocked;
    document.querySelector('#checkout-button').disabled = blocked || rows.length === 0;
    const status = document.querySelector('[data-concerto-status]');
    status.textContent = blocked ? 'Prerequisite unmet · Piano Solo is missing' : 'Prerequisite satisfied by Piano Solo in cart';
    status.classList.toggle('status-warning', blocked);
    status.classList.toggle('status-available', !blocked);
    const total = rows.reduce((sum, row) => sum + Number(row.dataset.price), 0);
    const emmaTotal = rows.filter(row => ['solo', 'concerto'].includes(row.dataset.cartItem)).reduce((sum, row) => sum + Number(row.dataset.price), 0);
    document.querySelector('[data-cart-total]').textContent = `$${total.toFixed(2)}`;
    document.querySelector('[data-emma-total]').textContent = `$${emmaTotal.toFixed(2)}`;
    document.querySelector('[data-leo-total]').textContent = `$${(total - emmaTotal).toFixed(2)}`;
    document.querySelector('[data-cart-item-count]').textContent = rows.length;
    document.querySelector('.cart-count').textContent = rows.length;
    document.querySelector('.cart-link').setAttribute('aria-label', `Cart, ${rows.length} registrations`);
    const toggle = document.querySelector('[data-state-toggle="cart"]');
    toggle.setAttribute('aria-pressed', String(!solo));
    toggle.textContent = !solo ? 'Restore Piano Solo' : 'Show missing prerequisite';
  }

  function setClosed(closed) {
    document.querySelector('#edit-open-note').hidden = closed;
    document.querySelector('#edit-closed-note').hidden = !closed;
    document.querySelector('#editable-repertoire').disabled = closed;
    document.querySelector('#editable-accompanist').disabled = closed;
    document.querySelector('#edit-save-actions').hidden = closed;
    const toggle = document.querySelector('[data-state-toggle="edit"]');
    toggle.textContent = closed ? 'Show editing open' : 'Show cutoff reached';
    toggle.setAttribute('aria-pressed', String(closed));
  }

  function showAddedState() {
    const status = document.querySelector('[data-solo-status]');
    if (status) {
      status.textContent = 'In cart';
      status.className = 'badge status-neutral';
      const action = document.querySelector('[data-solo-action]');
      action.textContent = 'View cart →';
      action.href = 'cart.html?added=1';
      action.className = 'text-link';
    }
    document.querySelectorAll('.cart-count').forEach(node => { node.textContent = '4'; });
    document.querySelectorAll('.cart-link').forEach(node => { node.href = 'cart.html?added=1'; node.setAttribute('aria-label', 'Cart, 4 registrations'); });
    const concerto = document.querySelector('.muted-row');
    if (concerto) {
      concerto.classList.remove('muted-row');
      concerto.querySelector('.badge').textContent = 'Prerequisite satisfied';
      concerto.querySelector('.badge').className = 'badge status-available';
      concerto.querySelector('.row-main > p').textContent = 'Qualifying Piano Solo is in your cart.';
      const button = concerto.querySelector('button');
      button.disabled = false;
      button.dataset.previewAction = 'concerto-form';
    }
    const cartItems = document.querySelector('.cart-items');
    if (cartItems) {
      const row = document.createElement('article');
      row.className = 'list-row';
      row.dataset.cartItem = 'piano';
      row.dataset.price = '45';
      row.innerHTML = '<div class="row-main"><p class="eyebrow">LEO CHEN · AGE 9</p><h2>Piano Solo</h2><p>Piano · Ages 9–10 · Maya Thompson</p><p class="muted">Minuet in G Major · Christian Petzold · 2:00</p><span class="badge status-available">Ready for checkout</span></div><div class="row-actions"><strong>$45.00</strong><button class="text-link" type="button" data-preview-action="remove-piano">Remove</button></div>';
      cartItems.append(row);
      updateCart();
    }
  }

  if (params.has('added')) showAddedState();
  if (document.body.dataset.page === 'edit') {
    const historical = params.get('state') === 'closed';
    if (params.get('performer') === 'leo') {
      document.querySelector('[data-edit-performer]').textContent = 'Leo Chen';
      document.querySelector('[data-edit-age]').textContent = 'Ages 9–10';
      document.querySelector('#edit-title').value = 'Sonatina in C Major, Op. 36 No. 1';
      document.querySelector('#edit-composer').value = 'Muzio Clementi';
      document.querySelector('#edit-minutes').value = '3';
      document.querySelector('.panel-heading .badge').textContent = '3:00 total';
    }
    if (historical) {
      document.querySelector('[data-edit-festival]').textContent = 'Spring Festival 2026';
      document.querySelector('[data-edit-class]').textContent = 'Baroque Piano';
      document.querySelector('[data-edit-teacher]').textContent = 'Historical name unavailable';
      document.querySelector('#edit-title').value = 'Invention No. 1 in C Major';
      document.querySelector('#edit-composer').value = 'Johann Sebastian Bach';
      document.querySelector('#edit-movement').value = '';
      document.querySelector('#edit-minutes').value = '2';
      document.querySelector('#edit-seconds').value = '30';
      document.querySelector('.panel-heading .badge').textContent = '2:30 total';
      document.querySelector('#edit-open-note strong').textContent = 'Editing closed April 3, 2026 at 12:00 a.m. Pacific.';
      document.querySelector('#edit-closed-note p').textContent = 'The April 3, 2026 cutoff has passed. Repertoire and accompanist details are read-only.';
      document.querySelector('.mockup-state-switcher').hidden = true;
    }
    setClosed(historical);
  }

  document.querySelector('[data-festival-filter]')?.addEventListener('change', event => {
    const selected = event.target.value;
    document.querySelectorAll('.registration-group').forEach(group => {
      const rows = [...group.querySelectorAll('[data-festival]')];
      rows.forEach(row => { row.hidden = selected !== 'all' && row.dataset.festival !== selected; });
      const count = rows.filter(row => !row.hidden).length;
      group.hidden = count === 0;
      group.querySelector('summary .muted').textContent = `${count} registration${count === 1 ? '' : 's'}`;
    });
  });
  document.addEventListener('input', event => {
    if (['class', 'edit'].includes(document.body.dataset.page) && event.target.closest('main')) dirty = true;
  });

  const editHelp = [...document.querySelectorAll('.registration-edit-help')];
  editHelp.forEach(help => {
    const trigger = help.querySelector('.registration-edit-info');
    const reveal = () => help.removeAttribute('data-tooltip-dismissed');
    help.addEventListener('pointerenter', reveal);
    trigger.addEventListener('focus', reveal);
    trigger.addEventListener('click', () => { reveal(); trigger.focus(); });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') help.setAttribute('data-tooltip-dismissed', '');
    });
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.registration-edit-help')) {
      editHelp.forEach(help => help.setAttribute('data-tooltip-dismissed', ''));
    }
  });

  document.addEventListener('click', event => {
    const target = event.target.closest('button, a');
    if (!target) return;
    if (target.matches('[data-close-dialog]')) return dialog.close();
    if (target.matches('.sidebar-toggle')) {
      document.body.classList.toggle('nav-collapsed');
      syncNavigation();
      return;
    }
    if (target.matches('.mobile-menu, [data-mobile-menu]')) {
      document.body.classList.toggle('nav-open');
      syncNavigation();
      return;
    }
    if (target.dataset.stateToggle === 'cart') {
      document.querySelector('[data-cart-item="solo"]').hidden = !document.querySelector('[data-cart-item="solo"]').hidden;
      return updateCart();
    }
    if (target.dataset.stateToggle === 'edit') return setClosed(target.getAttribute('aria-pressed') !== 'true');
    if (target.hasAttribute('data-preview-label')) {
      event.preventDefault();
      if (target.dataset.previewLabel === 'Teacher assistance') return showDialog('My teacher is not listed', 'Contact the festival office for help with your teacher’s registration. A registered teacher is required before adding a class.');
      if (target.dataset.previewLabel === 'Sign out') return showDialog('Sign out', 'This static preview does not change your signed-in account.');
      return showDialog(target.dataset.previewLabel, 'This existing account destination remains in the sidebar. It is outside these five registration mockups.');
    }
    if (target.hasAttribute('data-preview-action')) {
      event.preventDefault();
      const action = target.dataset.previewAction.toLowerCase();
      if (action === 'account') return showDialog('Your account', 'Jordan Chen is the signed-in parent in this preview. Memberships, contact details, order history, and availability remain in the account section of the navigation.');
      if (action.startsWith('remove-')) {
        const row = document.querySelector(`[data-cart-item="${action.slice(7)}"]`);
        if (row) row.hidden = true;
        return updateCart();
      }
      if (action === 'save-piece') {
        const title = document.querySelector('#piece-title');
        const composer = document.querySelector('#piece-composer');
        const minutes = Number(document.querySelector('#piece-minutes').value);
        const seconds = Number(document.querySelector('#piece-seconds').value);
        if (!title.value.trim() || !composer.value.trim() || minutes < 0 || seconds < 0 || seconds > 59 || minutes * 60 + seconds <= 0 || minutes * 60 + seconds > 360) return showDialog('Check the second piece', 'Enter a title, composer, and positive duration. Both pieces together must be no more than eight minutes.');
        secondPieceSaved = true;
        document.querySelector('#saved-piece-count').textContent = '2 of 2';
        document.querySelector('#saved-piece-duration').textContent = `${minutes + 2}:${String(seconds).padStart(2, '0')} / 8:00`;
        target.closest('.panel').querySelector('h2').textContent = title.value;
        target.closest('.panel').querySelector('.eyebrow').textContent = 'PIECE 2 · SAVED';
        target.closest('.panel').querySelector(':scope > p').textContent = `${composer.value} · ${minutes}:${String(seconds).padStart(2, '0')}`;
        target.closest('form').hidden = true;
        return toast('Second piece saved in this preview. The class maximum has been reached.');
      }
      if (action === 'add-to-cart') {
        const pieceForm = document.querySelector('[data-preview-form="piece"]');
        const hasUnfinishedPiece = [...pieceForm.querySelectorAll('input')].some(input => input.value.trim());
        if (hasUnfinishedPiece && !secondPieceSaved && !confirm('Discard the unfinished second piece and add the saved piece to your cart?')) return;
        dirty = false;
        location.href = 'index.html?added=1';
        return;
      }
      if (action.includes('waitlist')) return showWaitlist();
      if (action.includes('checkout')) return showDialog('Continue to Shopify', 'You would complete payment with Shopify after the registration checks pass. This static preview does not start checkout or process payments.');
      if (action.includes('teacher')) return showDialog('My teacher is not listed', 'Contact the festival office for help with your teacher’s registration. A registered teacher is required before adding a class.');
      if (action.includes('save')) { dirty = false; return toast('Saved-state preview. No registration data was changed.'); }
      if (action.includes('sign') || action.includes('logout')) return showDialog('Account controls', 'Account and sign-out controls stay in the simplified header. This preview does not change your account.');
      return showDialog(target.textContent.trim(), 'This is a static design preview. No account, cart, or registration data will be changed.');
    }
    if (target.matches('a[href]') && dirty && !target.getAttribute('href').startsWith('#')) {
      if (!confirm('Discard changes to this registration?')) event.preventDefault();
    }
  });

  document.addEventListener('submit', event => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    toast('Saved-state preview. No data was submitted.');
  });

  window.FestivalMockup = { showDialog, toast };
})();
