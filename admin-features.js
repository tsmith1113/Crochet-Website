function adminFeatureEscape(value) {
    const element = document.createElement('span');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
}

function showFeatureMessage(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.style.color = isError ? '#b00020' : '#276335';
}

async function adminFeatureRequest(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
}

function renderAdminReviews(reviews) {
    const container = document.getElementById('admin-reviews-list');
    if (!reviews.length) {
        container.innerHTML = '<p>No customer reviews yet.</p>';
        return;
    }
    container.innerHTML = reviews.map(review => `
        <article class="review-card">
            <h3>${adminFeatureEscape(review.product_name)} · ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</h3>
            <p><strong>${adminFeatureEscape(review.customer_name)}</strong> (${adminFeatureEscape(review.customer_email)}) · Order ${adminFeatureEscape(review.order_number)}</p>
            <p>${adminFeatureEscape(review.body)}</p>
            <p><strong>Status:</strong> ${adminFeatureEscape(review.status)} · Verified purchase</p>
            ${review.photoUrl ? `<img class="review-photo" src="${adminFeatureEscape(review.photoUrl)}" alt="Customer review photo">` : ''}
            ${review.removal_reason ? `<p><strong>Privacy removal request (${adminFeatureEscape(review.removal_status)}):</strong> ${adminFeatureEscape(review.removal_reason)}</p>` : ''}
            <label>Response to customer
                <textarea data-review-response="${Number(review.id)}" maxlength="2000">${adminFeatureEscape(review.admin_response || '')}</textarea>
            </label>
            <div class="admin-controls">
                <button type="button" class="button" data-review-action="published" data-review-id="${Number(review.id)}">Publish</button>
                <button type="button" class="button secondary" data-review-action="rejected" data-review-id="${Number(review.id)}">Reject</button>
                <button type="button" class="button secondary" data-review-remove="${Number(review.id)}">Remove for policy/privacy request</button>
            </div>
        </article>
    `).join('');
}

async function loadAdminReviews() {
    try {
        const reviews = await adminFeatureRequest('/api/admin/reviews');
        renderAdminReviews(reviews);
        showFeatureMessage('review-admin-message', `Loaded ${reviews.length} review${reviews.length === 1 ? '' : 's'}.`);
    } catch (error) {
        showFeatureMessage('review-admin-message', error.message, true);
    }
}

function renderAdminInventory(items) {
    const container = document.getElementById('admin-inventory-list');
    if (!items.length) {
        container.innerHTML = '<p>No ready-to-ship hats are listed.</p>';
        return;
    }
    container.innerHTML = `
        <table class="admin-table">
            <thead><tr><th>Item</th><th>Hat Type</th><th>Price</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>${items.map(item => `
                <tr>
                    <td>${adminFeatureEscape(item.name)}<br><small>${adminFeatureEscape(item.item_code)} · ${adminFeatureEscape(item.details)}</small></td>
                    <td>${adminFeatureEscape(item.product_name)}</td>
                    <td>$${(item.price_cents / 100).toFixed(2)}</td>
                    <td>${Number(item.quantity)}</td>
                    <td>${item.active ? 'Active' : 'Inactive'}</td>
                    <td>
                        ${item.active ? `<button type="button" class="button secondary" data-inventory-edit="${Number(item.id)}">Edit</button>
                        <button type="button" class="button secondary" data-inventory-remove="${Number(item.id)}">Deactivate</button>` : '—'}
                    </td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
}

async function loadAdminInventory() {
    try {
        const items = await adminFeatureRequest('/api/admin/inventory');
        renderAdminInventory(items);
    } catch (error) {
        showFeatureMessage('inventory-admin-message', error.message, true);
    }
}

function renderAdminPromotions(promotions) {
      const container = document.getElementById('admin-promotions-list');
      container.innerHTML = promotions.length ? `
          <table class="admin-table">
              <thead><tr><th>Code</th><th>Discount</th><th>Uses</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>${promotions.map(promotion => {
                  const discount = promotion.amountOff != null
                      ? `$${Number(promotion.amountOff).toFixed(2)} off`
                      : `${Number(promotion.percentOff || 0)}% off`;
                  return `
                      <tr>
                          <td>${adminFeatureEscape(promotion.code)}</td>
                          <td>${adminFeatureEscape(discount)}</td>
                          <td>${Number(promotion.timesRedeemed)}${promotion.maxRedemptions ? ` / ${Number(promotion.maxRedemptions)}` : ''}</td>
                          <td>${promotion.expiresAt ? new Date(promotion.expiresAt * 1000).toLocaleDateString() : '—'}</td>
                          <td>${promotion.active ? 'Active' : 'Inactive'}</td>
                          <td><button type="button" class="button secondary" data-promotion-id="${adminFeatureEscape(promotion.id)}" data-next-active="${!promotion.active}">${promotion.active ? 'Deactivate' : 'Activate'}</button></td>
                      </tr>
                  `;
              }).join('')}</tbody>
          </table>
      ` : '<p>No Stripe promotion codes found.</p>';
}

async function loadAdminPromotions() {
      try {
          const promotions = await adminFeatureRequest('/api/admin/promotions');
          renderAdminPromotions(promotions);
      } catch (error) {
          showFeatureMessage('promotion-admin-message', error.message, true);
      }
}

function renderAdminRewards(data) {
      const customers = document.getElementById('admin-rewards-customers');
      customers.innerHTML = data.customers.length ? `
          <table class="admin-table">
              <thead><tr><th>Customer</th><th>Birthday</th><th>Points</th><th>Adjust balance</th></tr></thead>
              <tbody>${data.customers.map(customer => `
                  <tr>
                      <td>${adminFeatureEscape(customer.name)}<br><small>${adminFeatureEscape(customer.email)}</small></td>
                      <td>${adminFeatureEscape(customer.birthday_date || 'Not saved')}</td>
                      <td>${Number(customer.points)}</td>
                      <td>
                          <form class="admin-points-adjust" data-user-id="${Number(customer.id)}">
                              <input type="number" name="points" min="-5000" max="5000" step="1" required placeholder="+/- points">
                              <input type="text" name="reason" maxlength="300" required placeholder="Reason">
                              <button type="submit" class="button secondary">Save</button>
                          </form>
                      </td>
                  </tr>
              `).join('')}</tbody>
          </table>
      ` : '<p>No customer reward accounts yet.</p>';

      document.getElementById('admin-rewards-activity').innerHTML = data.activity.length ? `
          <table class="admin-table">
              <thead><tr><th>Customer</th><th>Points</th><th>Activity</th><th>Date</th></tr></thead>
              <tbody>${data.activity.map(entry => `
                  <tr><td>${adminFeatureEscape(entry.email)}</td><td>${Number(entry.points) > 0 ? '+' : ''}${Number(entry.points)}</td>
                  <td>${adminFeatureEscape(entry.activity)}</td><td>${new Date(entry.created_at).toLocaleDateString()}</td></tr>
              `).join('')}</tbody>
          </table>
      ` : '<p>No points activity.</p>';

      document.getElementById('admin-referral-history').innerHTML = data.referrals.length ? `
          <table class="admin-table">
              <thead><tr><th>Referrer</th><th>Referred email</th><th>Order</th><th>Status</th></tr></thead>
              <tbody>${data.referrals.map(referral => `
                  <tr><td>${adminFeatureEscape(referral.referrer_email)}</td><td>${adminFeatureEscape(referral.referred_email)}</td>
                  <td>${adminFeatureEscape(referral.order_id || '—')}</td><td>${adminFeatureEscape(referral.status)}</td></tr>
              `).join('')}</tbody>
          </table>
      ` : '<p>No qualifying referrals yet.</p>';

      document.getElementById('admin-reward-discounts').innerHTML = data.discounts.length ? `
          <table class="admin-table">
              <thead><tr><th>Customer</th><th>Code</th><th>Reward</th><th>Status</th></tr></thead>
              <tbody>${data.discounts.map(discount => `
                  <tr><td>${adminFeatureEscape(discount.email)}</td><td>${adminFeatureEscape(discount.code)}</td>
                  <td>${adminFeatureEscape(discount.kind)}</td><td>${adminFeatureEscape(discount.status)}</td></tr>
              `).join('')}</tbody>
          </table>
      ` : '<p>No reward discounts issued.</p>';
}

async function loadAdminRewards() {
      try {
          const data = await adminFeatureRequest('/api/admin/rewards');
          renderAdminRewards(data);
      } catch (error) {
          showFeatureMessage('rewards-admin-message', error.message, true);
      }
}

document.getElementById('admin-reviews-list')?.addEventListener('click', async event => {
    const action = event.target.closest('[data-review-action]');
    const remove = event.target.closest('[data-review-remove]');
    try {
        if (action) {
            const id = action.dataset.reviewId;
            const response = document.querySelector(`[data-review-response="${id}"]`).value.trim();
            await adminFeatureRequest(`/api/admin/reviews/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: action.dataset.reviewAction, response })
            });
            showFeatureMessage('review-admin-message', `Review ${action.dataset.reviewAction}.`);
            await loadAdminReviews();
        } else if (remove) {
            if (!window.confirm('Remove this review and its uploaded photo from public display?')) return;
            await adminFeatureRequest(`/api/admin/reviews/${remove.dataset.reviewRemove}/remove`, { method: 'POST' });
            showFeatureMessage('review-admin-message', 'Review and photo removed from publication.');
            await loadAdminReviews();
        }
    } catch (error) {
        showFeatureMessage('review-admin-message', error.message, true);
    }
});

document.getElementById('inventory-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
        await adminFeatureRequest('/api/admin/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        form.reset();
        form.elements.itemCode.readOnly = false;
        showFeatureMessage('inventory-admin-message', 'Ready-to-ship inventory saved.');
        await loadAdminInventory();
    } catch (error) {
        showFeatureMessage('inventory-admin-message', error.message, true);
    }
});

document.getElementById('admin-inventory-list')?.addEventListener('click', async event => {
    const edit = event.target.closest('[data-inventory-edit]');
    const remove = event.target.closest('[data-inventory-remove]');
    try {
        if (edit) {
            const items = await adminFeatureRequest('/api/admin/inventory');
            const item = items.find(row => row.id === Number(edit.dataset.inventoryEdit));
            if (!item) throw new Error('Inventory item not found.');
            const form = document.getElementById('inventory-form');
            form.elements.itemCode.value = item.item_code;
            form.elements.itemCode.readOnly = true;
            form.elements.name.value = item.name;
            form.elements.productName.value = item.product_name;
            form.elements.details.value = item.details;
            form.elements.price.value = (item.price_cents / 100).toFixed(2);
            form.elements.quantity.value = item.quantity;
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (remove) {
            await adminFeatureRequest(`/api/admin/inventory/${remove.dataset.inventoryRemove}`, { method: 'DELETE' });
            showFeatureMessage('inventory-admin-message', 'Inventory item deactivated.');
            await loadAdminInventory();
        }
    } catch (error) {
        showFeatureMessage('inventory-admin-message', error.message, true);
    }
});

document.getElementById('inventory-form')?.elements.itemCode.addEventListener('input', event => {
    event.currentTarget.readOnly = false;
});

document.getElementById('promotion-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
        const result = await adminFeatureRequest('/api/admin/promotions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        form.reset();
        showFeatureMessage('promotion-admin-message', `Promotion ${result.code} created.`);
        await loadAdminPromotions();
    } catch (error) {
        showFeatureMessage('promotion-admin-message', error.message, true);
    }
});

document.getElementById('admin-promotions-list')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-promotion-id]');
    if (!button) return;
    try {
        await adminFeatureRequest(`/api/admin/promotions/${encodeURIComponent(button.dataset.promotionId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: button.dataset.nextActive === 'true' })
        });
        showFeatureMessage('promotion-admin-message', 'Promotion status updated.');
        await loadAdminPromotions();
    } catch (error) {
        showFeatureMessage('promotion-admin-message', error.message, true);
    }
});

document.getElementById('admin-rewards-customers')?.addEventListener('submit', async event => {
    const form = event.target.closest('.admin-points-adjust');
    if (!form) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
        await adminFeatureRequest(`/api/admin/rewards/${form.dataset.userId}/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        showFeatureMessage('rewards-admin-message', 'Points balance adjusted.');
        await loadAdminRewards();
    } catch (error) {
        showFeatureMessage('rewards-admin-message', error.message, true);
    }
});

window.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('/me');
    const data = await response.json();
    if (data.loggedIn && data.user.is_admin) {
        await Promise.all([loadAdminReviews(), loadAdminInventory(), loadAdminPromotions(), loadAdminRewards()]);
    }
});
