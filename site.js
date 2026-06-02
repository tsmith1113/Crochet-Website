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

const colorCountSelect = document.getElementById('color-count-select');
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

function createColorSelect(index) {
  const wrapper = document.createElement('label');
  wrapper.className = 'color-select-group';

  const title = document.createElement('span');
  title.textContent = `Color ${index + 1}`;

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

function updateDisabledOptions() {
  if (!colorPickers) return;
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
  if (!colorCountSelect || !colorPickers) return;

  const count = parseInt(colorCountSelect.value, 10) || 0;
  const currentPickers = Array.from(colorPickers.querySelectorAll('.color-select-group'));
  const values = currentPickers.map(group => group.querySelector('.color-select').value);

  const desiredPickers = [];
  desiredPickers.push(createColorSelect(0));

  if (count >= 2 && values[0]) {
    desiredPickers.push(createColorSelect(1));
  }

  if (count >= 3 && values[1]) {
    desiredPickers.push(createColorSelect(2));
  }

  colorPickers.innerHTML = '';
  desiredPickers.forEach((picker, index) => {
    const select = picker.querySelector('.color-select');
    if (values[index]) {
      select.value = values[index];
    }
    colorPickers.appendChild(picker);
  });

  if (colorPickers.children.length === 0) {
    colorPickers.appendChild(createColorSelect(0));
  }

  updateDisabledOptions();
}

function serializeCustomOrder() {
  if (!customForm) return null;

  const product = getSelectedProduct();
  const colors = getSelectedColors();
  const notes = customForm.querySelector('textarea[name="notes"]').value.trim();

  if (!product || !colors.length) return null;

  return {
    product,
    colors,
    notes
  };
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

function getProductPrice(product, colorCount) {
  const base = basePrices[product] || 0;
  return base + Math.max(0, colorCount - 1) * extraColorPrice;
}

function getShippingPrice(value) {
  return shippingPrices[value] || 0;
}

function updateCheckoutSummary() {
  const order = loadCustomOrder();
  if (!summaryProduct || !summaryColors || !summaryProductPrice || !summaryShipping || !summaryTotal) return;

  if (!order) {
    summaryProduct.textContent = 'No product selected';
    summaryColors.textContent = 'Choose a product and colors on the home page.';
    summaryProductPrice.textContent = '$0';
    summaryShipping.textContent = '$0';
    summaryTotal.textContent = '$0';
    return;
  }

  const colorCount = order.colors.length;
  const subtotal = getProductPrice(order.product, colorCount);
  const shippingKey = shippingSelect ? shippingSelect.value : 'standard';
  const shippingCost = getShippingPrice(shippingKey);
  const total = subtotal + shippingCost;

  summaryProduct.textContent = `${order.product}`;
  summaryColors.textContent = `${order.colors.join(', ')}`;
  summaryProductPrice.textContent = `$${subtotal}`;
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
    if (validateCustomOrder() && storeCustomOrder()) {
      window.location.href = 'checkout.html';
    }
  });
}

if (checkoutForm) {
  checkoutForm.addEventListener('submit', handleFormSubmit);
}

if (colorCountSelect) {
  colorCountSelect.addEventListener('change', updateColorPickers);
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
  updateCheckoutSummary();
});
