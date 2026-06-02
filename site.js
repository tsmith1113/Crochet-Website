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
const productSelect = customForm ? customForm.querySelector('select[name="product"]') : null;
const bucketHatStyleControl = document.getElementById('bucket-hat-style-control');
const bucketHatStyleSelect = document.getElementById('bucket-hat-color-style');
const allOneColorControl = document.getElementById('all-one-color-control');
const allOneColorCheckbox = document.getElementById('all-one-color-checkbox');
const extraColorNote = document.getElementById('extra-color-note');

function getProductColorLabels(product) {
  switch (product) {
    case 'Beanie':
      return ['Color'];
    case 'Scrunchie':
      return ['Primary Color', 'Accent Color'];
    case 'Ruffle Bucket Hat':
      if (bucketHatStyleSelect) {
        if (bucketHatStyleSelect.value === 'main-top') {
          return ['Main Color', 'Top Color'];
        }
        if (bucketHatStyleSelect.value === 'main-outer') {
          return ['Main Color', 'Outer Color'];
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
        bucketHatStyleSelect.value = 'main-top';
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
    allOneColor: Boolean(allOneColor)
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

function loadOrder() {
  return loadCustomOrder();
}

function getProductPrice(product, colorCount) {
  const base = basePrices[product] || 0;
  const thirdColorSurcharge = product === 'Ruffle Bucket Hat' && colorCount === 3 ? 2 : 0;
  return base + thirdColorSurcharge;
}

function shouldShowThirdColorNote() {
  if (!extraColorNote || !bucketHatStyleSelect) return false;
  const product = getSelectedProduct();
  if (product !== 'Ruffle Bucket Hat' || bucketHatStyleSelect.value !== 'main-outer-top') return false;
  const selects = Array.from(colorPickers.querySelectorAll('.color-select'));
  return Boolean(selects[2] && selects[2].value);
}

function updateThirdColorNote() {
  if (!extraColorNote) return;
  if (shouldShowThirdColorNote()) {
    extraColorNote.style.display = 'block';
  } else {
    extraColorNote.style.display = 'none';
  }
}

function getShippingPrice(value) {
  return shippingPrices[value] || 0;
}

function updateCheckoutSummary() {
  const order = loadOrder();
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
  const shippingKey = shippingSelect && shippingSelect.value ? shippingSelect.value : 'standard';
  const shippingCost = getShippingPrice(shippingKey);
  const total = subtotal + shippingCost;

  summaryProduct.textContent = `${order.product}`;
  const colorText = order.allOneColor && order.colors.length
    ? `All one color: ${order.colors[0]}`
    : `${order.colors.join(', ')}`;
  summaryColors.textContent = order.product === 'Ruffle Bucket Hat' && order.colors.length === 3
    ? `${colorText} (+$2)`
    : colorText;
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
    if (!validateCustomOrder()) return;
    if (storeCustomOrder()) {
      window.location.href = 'checkout.html';
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
  updateCheckoutSummary();
});
