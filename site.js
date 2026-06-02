const colorChoices = [
  'Blush Pink',
  'Soft Cream',
  'Sage Green',
  'Mustard Yellow',
  'Lavender',
  'Charcoal Gray'
];

const basePrices = {
  Beanie: 25,
  'Ruffle Bucket Hat': 35,
  Scrunchie: 8
};

const extraColorPrice = 7;
const shippingPrices = {
  standard: 5,
  express: 12
};

const colorPickers = document.getElementById('color-pickers');
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');
const customForm = document.getElementById('custom-form');
const checkoutForm = document.getElementById('checkout-form');
const customMessage = document.getElementById('custom-form-message');
const checkoutMessage = document.getElementById('checkout-form-message');
const goCheckoutButton = document.getElementById('go-checkout-button');
const shippingSelect = document.getElementById('shipping-select');
const summaryProduct = document.getElementById('summary-product');
const summaryColors = document.getElementById('summary-colors');
const summaryProductPrice = document.getElementById('summary-product-price');
const summaryShipping = document.getElementById('summary-shipping');
const summaryTotal = document.getElementById('summary-total');
const summaryExtraLine = document.getElementById('summary-extra-line');
const summaryExtra = document.getElementById('summary-extra');
const checkoutItemList = document.getElementById('checkout-item-list');
const singleSummaryItem = document.getElementById('single-summary-item');
const productSelect = customForm ? customForm.querySelector('select[name="product"]') : null;
const bucketHatStyleControl = document.getElementById('bucket-hat-style-control');
const bucketHatStyleSelect = document.getElementById('bucket-hat-color-style');
const allOneColorControl = document.getElementById('all-one-color-control');
const allOneColorCheckbox = document.getElementById('all-one-color-checkbox');
const extraColorNote = document.getElementById('extra-color-note');
const addToOrderButton = document.getElementById('add-to-order-button');
const orderCartMessage = document.getElementById('order-cart-message');
const orderCartList = document.getElementById('order-cart-list');
const orderItemsKey = 'stitchedByTraeOrderItems';

function getProductColorLabels(product) {
  switch (product) {
    case 'Beanie':
      return ['Color'];
    case 'Scrunchie':
      return ['Primary Color', 'Accent Color'];
    case 'Ruffle Bucket Hat':
      if (bucketHatStyleSelect) {
        if (bucketHatStyleSelect.value === 'main-rest') {
          return ['Main Color', 'Rest of Hat'];
        }
      }
      return ['Main Color', 'Outer Color', 'Top Color'];
    default:
      return ['Main Color'];
  }
}

function createColorSelect(index, labelText = null) {
  const wrapper = document.createElement('label');
  wrapper.className = 'color-select-group';

  const title = document.createElement('span');
  title.textContent = labelText || `Color ${index + 1}`;

  const select = document.createElement('select');
  select.className = 'color-select';
  select.required = true;
  select.dataset.index = index;
  select.name = `color${index + 1}`;
  select.innerHTML = `
    <option value="">Select Color</option>
    ${colorChoices.map(color => `<option value="${color}">${color}</option>`).join('')}
  `;

  wrapper.append(title, select);
  return wrapper;
}

function getSelectedColors() {
  if (!colorPickers) return [];
  return Array.from(colorPickers.querySelectorAll('.color-select'))
    .map(select => select.value)
    .filter(Boolean);
}

function getSelectedProduct() {
  if (!customForm) return '';
  return customForm.querySelector('select[name="product"]').value;
}

function validateCustomOrder() {
  const product = getSelectedProduct();
  const colors = getSelectedColors();

  if (!product) {
    if (customMessage) customMessage.textContent = 'Please select a product before proceeding to checkout.';
    return false;
  }

  if (!colors.length) {
    if (customMessage) customMessage.textContent = 'Please select at least one color before proceeding to checkout.';
    return false;
  }

  if (customMessage) customMessage.textContent = '';
  return true;
}

function supportsAllOneColor(product) {
  return product === 'Scrunchie' || product === 'Ruffle Bucket Hat';
}

function updateAllOneColorState() {
  if (!colorPickers) return;
  const checked = allOneColorCheckbox && allOneColorCheckbox.checked;
  const colorSelects = Array.from(colorPickers.querySelectorAll('.color-select'));

  colorSelects.forEach((select, index) => {
    if (index === 0) {
      select.required = true;
      select.disabled = false;
      return;
    }

    select.disabled = checked;
    select.required = !checked;
    if (checked) {
      select.value = '';
    }
  });
}

function updateDisabledOptions() {
  if (!colorPickers) return;
  if (allOneColorCheckbox && allOneColorCheckbox.checked) {
    updateAllOneColorState();
    return;
  }

  const selectedColors = getSelectedColors();
  const colorSelects = colorPickers.querySelectorAll('.color-select');

  colorSelects.forEach(select => {
    const currentValue = select.value;
    Array.from(select.options).forEach(option => {
      if (!option.value) {
        option.disabled = false;
        return;
      }
      option.disabled = selectedColors.includes(option.value) && option.value !== currentValue;
    });
  });
}

function updateColorPickers() {
  if (!colorPickers || !productSelect) return;

  const product = getSelectedProduct();
  const colorLabels = getProductColorLabels(product);
  const currentPickers = Array.from(colorPickers.querySelectorAll('.color-select-group'));
  const values = currentPickers.map(group => group.querySelector('.color-select').value);

  colorPickers.innerHTML = '';

  colorLabels.forEach((label, index) => {
    const picker = createColorSelect(index, label);
    const select = picker.querySelector('.color-select');
    if (values[index]) {
      select.value = values[index];
    }
    colorPickers.appendChild(picker);
  });

  if (bucketHatStyleControl) {
    if (product === 'Ruffle Bucket Hat') {
      bucketHatStyleControl.style.display = 'block';
    } else {
      bucketHatStyleControl.style.display = 'none';
      if (bucketHatStyleSelect) {
        bucketHatStyleSelect.value = 'main-rest';
      }
    }
  }

  if (allOneColorControl) {
    if (supportsAllOneColor(product)) {
      if (colorPickers.firstElementChild) {
        colorPickers.insertBefore(allOneColorControl, colorPickers.children[1] || null);
      }
      allOneColorControl.style.display = 'block';
    } else {
      allOneColorControl.style.display = 'none';
      if (allOneColorCheckbox) {
        allOneColorCheckbox.checked = false;
      }
    }
  }

  updateDisabledOptions();
  updateThirdColorNote();
}

function serializeCustomOrder() {
  if (!customForm) return null;

  const product = getSelectedProduct();
  const selectedColors = getSelectedColors();
  const notes = customForm.querySelector('textarea[name="notes"]').value.trim();
  const allOneColor = allOneColorCheckbox && allOneColorCheckbox.checked;
  const bucketHatStyle = bucketHatStyleSelect ? bucketHatStyleSelect.value : '';

  if (!product || !selectedColors.length) return null;

  let colors = selectedColors;
  if (allOneColor && supportsAllOneColor(product)) {
    const expectedCount = getProductColorLabels(product).length;
    colors = Array(expectedCount).fill(selectedColors[0]);
  }

  return {
    product,
    colors,
    notes,
    allOneColor: Boolean(allOneColor),
    bucketHatStyle
  };
}

function loadOrderItems() {
  try {
    const stored = window.localStorage.getItem(orderItemsKey);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveOrderItems(items) {
  window.localStorage.setItem(orderItemsKey, JSON.stringify(items));
}

function addCurrentOrderItem() {
  const order = serializeCustomOrder();
  if (!order) return false;
  const items = loadOrderItems();
  items.push(order);
  saveOrderItems(items);
  return true;
}

function storeCustomOrder() {
  const order = serializeCustomOrder();
  if (!order) return false;
  window.localStorage.setItem('stitchedByTraeOrder', JSON.stringify(order));
  return true;
}

function loadCustomOrder() {
  try {
    const stored = window.localStorage.getItem('stitchedByTraeOrder');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function loadOrder() {
  return loadCustomOrder();
}

function getProductPrice(product, colorCount, allOneColor = false, bucketHatStyle = '') {
  const base = basePrices[product] || 0;
  const thirdColorSurcharge = product === 'Ruffle Bucket Hat' && colorCount === 3 && bucketHatStyle === 'main-outer-top' && !allOneColor ? 2 : 0;
  return base + thirdColorSurcharge;
}

function getExtraColorNoteText() {
  if (!extraColorNote || !bucketHatStyleSelect) return '';
  const product = getSelectedProduct();
  if (product !== 'Ruffle Bucket Hat' || bucketHatStyleSelect.value !== 'main-outer-top') return '';
  const allOneColor = allOneColorCheckbox && allOneColorCheckbox.checked;
  const selects = Array.from(colorPickers.querySelectorAll('.color-select'));
  if (!allOneColor && selects[2] && selects[2].value) {
    return 'Third color adds $2.';
  }
  return '';
}

function updateThirdColorNote() {
  if (!extraColorNote) return;
  const noteText = getExtraColorNoteText();
  if (noteText) {
    extraColorNote.textContent = noteText;
    extraColorNote.style.display = 'block';
  } else {
    extraColorNote.style.display = 'none';
  }
}

function getShippingPrice(value) {
  return shippingPrices[value] || 0;
}

function renderCartList() {
  if (!orderCartList || !orderCartMessage) return;
  const items = loadOrderItems();
  if (!items.length) {
    orderCartMessage.textContent = 'No items in your order yet.';
    orderCartList.innerHTML = '';
    return;
  }

  orderCartMessage.textContent = `You have ${items.length} item${items.length === 1 ? '' : 's'} in your order.`;
  orderCartList.innerHTML = items.map((item, index) => {
    const colorLabel = item.allOneColor && item.colors.length
      ? `All one color: ${item.colors[0]}`
      : item.colors.join(', ');
    const itemPrice = getProductPrice(item.product, item.colors.length, item.allOneColor, item.bucketHatStyle);
    return `
      <div class="cart-list-item">
        <strong>${index + 1}. ${item.product}</strong>
        <p>${colorLabel}</p>
        <p>${item.notes ? item.notes : ''}</p>
        <span>$${itemPrice}</span>
      </div>
    `;
  }).join('');
}

function updateCheckoutSummary() {
  const items = loadOrderItems();
  if (!summaryProduct || !summaryColors || !summaryProductPrice || !summaryShipping || !summaryTotal || !checkoutItemList || !singleSummaryItem || !summaryExtraLine || !summaryExtra) return;

  if (!items.length) {
    singleSummaryItem.style.display = 'flex';
    checkoutItemList.style.display = 'none';
    summaryExtraLine.style.display = 'none';
    summaryProduct.textContent = 'No product selected';
    summaryColors.textContent = 'Select a product and colors to see the price.';
    summaryProductPrice.textContent = '$0';
    summaryShipping.textContent = '$0';
    summaryTotal.textContent = '$0';
    return;
  }

  const shippingKey = shippingSelect && shippingSelect.value ? shippingSelect.value : 'standard';
  const shippingCost = getShippingPrice(shippingKey);
  const subtotal = items.reduce((sum, item) => {
    return sum + getProductPrice(item.product, item.colors.length, item.allOneColor, item.bucketHatStyle);
  }, 0);
  const extraFee = items.reduce((sum, item) => {
    return sum + (item.product === 'Ruffle Bucket Hat' && item.colors.length === 3 && item.bucketHatStyle === 'main-outer-top' && !item.allOneColor ? 2 : 0);
  }, 0);
  const total = subtotal + shippingCost;

  if (items.length === 1) {
    checkoutItemList.style.display = 'none';
    singleSummaryItem.style.display = 'flex';
    summaryExtraLine.style.display = extraFee ? 'flex' : 'none';
    if (extraFee) {
      summaryExtra.textContent = `$${extraFee}`;
    }
    const order = items[0];
    summaryProduct.textContent = `${order.product}`;
    const colorText = order.allOneColor && order.colors.length
      ? `All one color: ${order.colors[0]}`
      : `${order.colors.join(', ')}`;
    summaryColors.textContent = colorText;
    summaryProductPrice.textContent = `$${subtotal}`;
  } else {
    singleSummaryItem.style.display = 'none';
    checkoutItemList.style.display = 'grid';
    checkoutItemList.innerHTML = items.map((order, index) => {
      const colorText = order.allOneColor && order.colors.length
        ? `All one color: ${order.colors[0]}`
        : `${order.colors.join(', ')}`;
      const price = getProductPrice(order.product, order.colors.length, order.allOneColor, order.bucketHatStyle);
      return `
        <div class="checkout-item-row">
          <div>
            <p class="item-title">${index + 1}. ${order.product}</p>
            <p class="item-meta">${colorText}</p>
          </div>
          <strong>$${price}</strong>
        </div>
      `;
    }).join('');
    summaryProduct.textContent = `${items.length} items in order`;
    summaryColors.textContent = 'Review the list above for details.';
    summaryProductPrice.textContent = `$${subtotal}`;
    summaryExtraLine.style.display = extraFee ? 'flex' : 'none';
    if (extraFee) {
      summaryExtra.textContent = `$${extraFee}`;
    }
  }

  summaryShipping.textContent = `$${shippingCost}`;
  summaryTotal.textContent = `$${total}`;
}

function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  if (form.id === 'checkout-form') {
    if (checkoutMessage) {
      checkoutMessage.textContent = 'Thanks! Your checkout request is complete.';
    }
    form.reset();
    if (shippingSelect) shippingSelect.value = '';
    updateCheckoutSummary();
    setTimeout(() => {
      if (checkoutMessage) checkoutMessage.textContent = '';
    }, 5000);
  }
}

function closeMobileNav() {
  if (!navLinks || !navToggle) return;
  navLinks.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
}

function toggleMobileNav() {
  if (!navLinks || !navToggle) return;
  const isOpen = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
}

if (navToggle) {
  navToggle.addEventListener('click', event => {
    event.stopPropagation();
    toggleMobileNav();
  });
}

if (navLinks) {
  navLinks.addEventListener('click', event => {
    if (event.target.tagName === 'A') {
      closeMobileNav();
    }
  });
}

window.addEventListener('click', event => {
  if (!navLinks || !navToggle) return;
  if (!navLinks.contains(event.target) && !navToggle.contains(event.target)) {
    closeMobileNav();
  }
});

if (customForm) {
  customForm.addEventListener('submit', handleFormSubmit);
}

if (goCheckoutButton) {
  goCheckoutButton.addEventListener('click', () => {
    if (!validateCustomOrder()) return;
    addCurrentOrderItem();
    window.location.href = 'checkout.html';
  });
}

if (addToOrderButton) {
  addToOrderButton.addEventListener('click', () => {
    if (!validateCustomOrder()) return;
    if (addCurrentOrderItem()) {
      renderCartList();
      if (customMessage) customMessage.textContent = 'Item added to your order.';
    }
  });
}

if (productSelect) {
  productSelect.addEventListener('change', updateColorPickers);
}

if (bucketHatStyleSelect) {
  bucketHatStyleSelect.addEventListener('change', updateColorPickers);
}

if (allOneColorCheckbox) {
  allOneColorCheckbox.addEventListener('change', () => {
    updateAllOneColorState();
    updateDisabledOptions();
    updateThirdColorNote();
  });
}

if (checkoutForm) {
  checkoutForm.addEventListener('submit', handleFormSubmit);
}

if (colorPickers) {
  colorPickers.addEventListener('change', event => {
    if (event.target.classList.contains('color-select')) {
      updateColorPickers();
    }
  });
}

if (shippingSelect) {
  shippingSelect.addEventListener('change', updateCheckoutSummary);
}

window.addEventListener('DOMContentLoaded', () => {
  updateColorPickers();
  renderCartList();
  updateCheckoutSummary();
});
