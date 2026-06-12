const apiBase = '';
const ordersBody = document.getElementById('orders-table-body');
const adminMessage = document.getElementById('admin-message');

function getItemColorLabels(product, bucketHatStyle) {
  if (product === 'Ruffle Bucket Hat') {
    return bucketHatStyle === 'main-rest'
      ? ['Main Color', 'Rest of Hat']
      : ['Main Color', 'Outer Color', 'Top Color'];
  }
  return ['Color'];
}

function showAdminMessage(message, isError = false) {
  if (!adminMessage) return;
  adminMessage.textContent = message;
  adminMessage.style.color = isError ? '#b00020' : '#1a7f37';
}

function formatAmount(value) {
  return `$${Number(value).toFixed(2)}`;
}

function renderOrders(orders) {
  if (!ordersBody) return;
  if (!orders.length) {
    ordersBody.innerHTML = '<tr><td colspan="7">No orders found.</td></tr>';
    return;
  }

  ordersBody.innerHTML = orders.map(order => {
  const isShipped = order.status === 'shipped';

  const items = (order.items || [])
    .map(item => {
      const details = [];
      if (item.colors?.length) {
        const labels = getItemColorLabels(item.product, item.bucketHatStyle);
        details.push(item.colors.map((c, i) => `${labels[i] || 'Color'}: ${c}`).join(', '));
      }
      if (item.bucketHatStyle) details.push(`Style: ${item.bucketHatStyle.replace(/-/g, ' ')}`);
      if (item.headCircumference) details.push(`Head: ${item.headCircumference}"`);
      if (item.size) details.push(`Size: ${item.size}`);
      if (item.rowCount && item.rowCount > 1) details.push(`Rows: ${item.rowCount}`);
      if (item.allOneColor) details.push('All one color');
      return `
        <div style="margin-bottom:4px;">
          <strong>${item.product}</strong><br>
          <small>${details.join(' · ') || '—'}</small>
        </div>
      `;
    })
    .join('');
    return `
      <tr>
        <td>${order.order_number}</td>
        <td>
  ${order.email}
  <br>
  <small>${order.full_name || ''}</small>
</td>

<td>${items}</td>
        <td>${formatAmount(order.total)}</td>
        <td>${order.shipping}</td>
        <td class="admin-status">${order.status}</td>
        <td>
  <input
    type="text"
    class="tracking-input"
    data-id="${order.id}"
    value="${order.tracking_number || ''}"
    placeholder="Enter tracking"
    ${isShipped ? 'disabled' : ''}
  >
</td>
        <td>
          <button type="button" class="ship-button" data-id="${order.id}" ${isShipped ? 'disabled' : ''}>
            ${isShipped ? 'Shipped' : 'Mark Shipped'}
          </button>
          <button type="button" class="resend-button" data-id="${order.id}" style="margin-top:6px;">
            Resend Email
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadOrders() {
  try {
    showAdminMessage('Loading orders...');
    const response = await fetch(`${apiBase}/orders`);
    const data = await response.json();
    if (!response.ok) {
      showAdminMessage(`Error loading orders: ${data.error || response.status}`, true);
      return;
    }
    const orders = Array.isArray(data) ? data : [];
    renderOrders(orders);
    showAdminMessage(`Loaded ${orders.length} order${orders.length === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error);
    showAdminMessage('Unable to load orders. Check the browser console for details.', true);
  }
}

async function markShipped(orderId, trackingNumber) {
  try {
    showAdminMessage('Sending shipping email...');

    const response = await fetch(
      `${apiBase}/orders/${orderId}/ship`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          trackingNumber
        })
      }
    );

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Unable to mark shipped.');
    }

    showAdminMessage(`Order ${result.order_number} marked shipped.`);
    await loadOrders();
  } catch (error) {
    console.error(error);
    showAdminMessage(error.message || 'Unable to mark order shipped.', true);
  }
}

async function resendConfirmation(orderId) {
  try {
    showAdminMessage('Sending confirmation email...');
    const response = await fetch(`${apiBase}/orders/${orderId}/resend-confirmation`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to send email.');
    showAdminMessage(`Confirmation email sent for order ${result.order_number}.`);
  } catch (error) {
    showAdminMessage(error.message, true);
  }
}

if (ordersBody) {
  ordersBody.addEventListener('click', event => {
    const shipButton = event.target.closest('.ship-button');
    if (shipButton) {
      const orderId = shipButton.dataset.id;
      if (orderId) {
        const trackingInput = document.querySelector(`.tracking-input[data-id="${orderId}"]`);
        const trackingNumber = trackingInput?.value.trim();
        markShipped(orderId, trackingNumber);
      }
    }

    const resendButton = event.target.closest('.resend-button');
    if (resendButton) {
      resendConfirmation(resendButton.dataset.id);
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/me');
    const data = await res.json();
    if (!data.loggedIn || !data.user.is_admin) {
      window.location.href = '/login';
      return;
    }
  } catch {
    window.location.href = '/login';
    return;
  }
  loadOrders();
});
