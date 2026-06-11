const apiBase = '';
const ordersBody = document.getElementById('orders-table-body');
const adminMessage = document.getElementById('admin-message');

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
    .map(item => `
      <div>
        <strong>${item.product}</strong><br>
        ${item.colors?.join(', ') || ''}
      </div>
    `)
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
        </td>
      </tr>
    `;
  }).join('');
}

async function loadOrders() {
  try {
    showAdminMessage('Loading orders...');
    const response = await fetch(`${apiBase}/orders`);
    const orders = await response.json();
    renderOrders(orders);
    showAdminMessage(`Loaded ${orders.length} order${orders.length === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error);
    showAdminMessage('Unable to load orders.', true);
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

if (ordersBody) {
  ordersBody.addEventListener('click', event => {
    const button = event.target.closest('.ship-button');
    if (!button) return;
    const orderId = button.dataset.id;
    if (orderId) {
      const trackingInput =
  document.querySelector(
    `.tracking-input[data-id="${orderId}"]`
  );

const trackingNumber =
  trackingInput?.value.trim();

markShipped(orderId, trackingNumber);
    }
  });
}

window.addEventListener('DOMContentLoaded', loadOrders);
