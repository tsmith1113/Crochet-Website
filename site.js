const colorChoices = [
  'Black',
  'White',
  'Gray',
  'Charcoal',
  'Cream',
  'Beige',
  'Tan',
  'Brown',
  'Red',
  'Burgundy',
  'Maroon',
  'Orange',
  'Burnt Orange',
  'Yellow',
  'Mustard',
  'Gold',
  'Green',
  'Forest Green',
  'Olive',
  'Sage',
  'Mint',
  'Blue',
  'Navy',
  'Royal Blue',
  'Sky Blue',
  'Teal',
  'Turquoise',
  'Purple',
  'Lavender',
  'Lilac',
  'Pink',
  'Hot Pink',
  'Rose Pink',
  'Blush Pink',
  'Peach'
];

const basePrices = {
  Beanie: 25,
  'Bucket Hat': 25,
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
const stripeCheckoutButton = document.getElementById('stripe-checkout-button');
const stripeStatusMessage = document.getElementById('stripe-status-message');
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
const scrunchieRowCountControl = document.getElementById('scrunchie-row-count-control');
const scrunchieRowCountSelect = document.getElementById('scrunchie-row-count');
const extraColorNote = document.getElementById('extra-color-note');
const measurementSection = document.querySelector('.measurement-section');
const headCircumferenceInput = document.getElementById('head-circumference-input');
const sizeSelectInput = document.getElementById('size-select');
const rememberDetailsCheckbox = document.getElementById('remember-details');
const receiptSummary = document.getElementById('receipt-summary');
const sendReceiptButton = document.getElementById('send-receipt-button');
const addToOrderButton = document.getElementById('add-to-order-button');
const orderCartMessage = document.getElementById('order-cart-message');
const orderCartList = document.getElementById('order-cart-list');
const orderItemsKey = 'stitchedByTraeOrderItems';
const orderSessionKey = 'stitchedByTraeOrderSession';

const stripeConfig = {
  publishableKey: "pk_test_51Tf0UnK7MUFGeMDDJsC7iop9mkqYBnlNwOk4SV5eZRulyGMJB8h1kkK8IqAgW3Ey15hqLpYkHxOrTCF91hWt7Ftd00NVymVX8U",

  priceIds: {
    "Bucket Hat": "price_1Tf0rJK7MUFGeMDD1U4BIDsU",
    "Ruffle Bucket Hat": "price_1Tf0rJK7MUFGeMDDuwZ8kjHG",
    "Beanie": "price_1Tf0rJK7MUFGeMDDFHsxUiZu",
    "Scrunchie": "price_1Tf0rJK7MUFGeMDDXDu3iMZr"
  },

  successUrl: window.location.origin + "/checkout.html?payment=success",
  cancelUrl: window.location.origin + "/checkout.html?payment=cancel"
};

const billingDetailsKey = 'stitchedByTraeBillingDetails';
const rememberDetailsKey = 'stitchedByTraeRememberDetails';

const productImageSets = {
  bucket: [
    'Pictures/Beanie Front.JPG',
    'Pictures/Beanie Back.JPG',
    'Pictures/Black Beanie Middle.JPG',
    'Pictures/Black Beanie Side.JPG'
  ],
  buckethat: [
    'Pictures/Brown Bucket Hat Front.JPG',
    'Pictures/Brown Bucket Hat Back.JPG',
    'Pictures/Brown Side.JPG'
  ],
  ruffle: [
    'Pictures/Red Hat Front .JPG',
    'Pictures/Red Hat Head Down.JPG',
    'Pictures/Pink Hat Front View.JPG',
    'Pictures/Pink Bucket Hat Back C.JPG'
  ],
  scrunchie: [
    'Pictures/Orange Scrunchie.JPG',
    'Pictures/Purple Scrunchie.JPG',
    'Pictures/Tan Scrunchie.JPG'
  ]
};

const imageIndexes = {
  bucket: 0,
  buckethat: 0,
  ruffle: 0,
  scrunchie: 0
};

function changeSlide(productKey, direction) {
  const imageSet = productImageSets[productKey];
  if (!imageSet) return;

  const imageElement = document.getElementById(`${productKey}-image`);
  if (!imageElement) return;

  imageIndexes[productKey] = (imageIndexes[productKey] + direction + imageSet.length) % imageSet.length;
  imageElement.src = imageSet[imageIndexes[productKey]];
}

function getProductColorLabels(product) {
  switch (product) {
    case 'Bucket Hat':
    case 'Beanie':
      return ['Color'];
    case 'Scrunchie': {
  const rows = Number(scrunchieRowCountSelect?.value || 1);

  if (rows === 1) {
    return ['Row Color'];
  }

  if (rows === 2) {
    return [
      'Outer Row Color',
      'Inner Row Color'
    ];
  }

  return [
    'Outer Row Color',
    'Middle Row Color',
    'Inner Row Color'
  ];
}
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

function getMeasurementValues() {
  if (!customForm) return { headCircumference: '', size: '' };
  const headCircumference = customForm.querySelector('input[name="headCircumference"]').value.trim();
  const size = customForm.querySelector('select[name="size"]').value;
  return { headCircumference, size };
}

function updateMeasurementInputs() {
  if (!headCircumferenceInput || !sizeSelectInput) return;
  const hasMeasurement = headCircumferenceInput.value.trim().length > 0;
  const hasSize = sizeSelectInput.value.trim().length > 0;

  if (hasMeasurement) {
    sizeSelectInput.disabled = true;
    if (sizeSelectInput.value) {
      sizeSelectInput.value = '';
    }
  } else {
    sizeSelectInput.disabled = false;
  }

  if (hasSize) {
    headCircumferenceInput.disabled = true;
    if (headCircumferenceInput.value) {
      headCircumferenceInput.value = '';
    }
  } else {
    headCircumferenceInput.disabled = false;
  }
}

function getSelectedProduct() {
  if (!customForm) return '';
  return customForm.querySelector('select[name="product"]').value;
}

function requiresMeasurements(product) {
  return product === 'Bucket Hat' || product === 'Beanie' || product === 'Ruffle Bucket Hat';
}

function validateCustomOrder() {
  const product = getSelectedProduct();
  const colors = getSelectedColors();
  const { headCircumference, size } = getMeasurementValues();

  if (!product) {
    if (customMessage) customMessage.textContent = 'Please select a product before proceeding to checkout.';
    return false;
  }

  if (!colors.length) {
    if (customMessage) customMessage.textContent = 'Please select at least one color before proceeding to checkout.';
    return false;
  }

  if (requiresMeasurements(product)) {
    if (!headCircumference && !size) {
      if (customMessage) customMessage.textContent = 'Please enter your head measurement or select a size.';
      return false;
    }

    if (headCircumference && Number.isNaN(Number(headCircumference))) {
      if (customMessage) customMessage.textContent = 'Please enter a valid number for your head circumference.';
      return false;
    }
  }

  if (headCircumference && Number.isNaN(Number(headCircumference))) {
    if (customMessage) customMessage.textContent = 'Please enter a valid number for your head circumference.';
    return false;
  }

  if (customMessage) customMessage.textContent = '';
  return true;
}

function supportsAllOneColor(product) {
  if (product === 'Ruffle Bucket Hat') {
    return true;
  }

  if (product === 'Scrunchie') {
    return Number(scrunchieRowCountSelect?.value || 1) > 1;
  }

  return false;
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

function updateScrunchieRowCountControl() {
  if (!scrunchieRowCountControl || !scrunchieRowCountSelect) return;
  const product = getSelectedProduct();
  if (product === 'Scrunchie') {
    scrunchieRowCountControl.style.display = 'block';
    if (!scrunchieRowCountSelect.value) {
      scrunchieRowCountSelect.value = '1';
    }
  } else {
    scrunchieRowCountControl.style.display = 'none';
    scrunchieRowCountSelect.value = '1';
  }
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

  if (measurementSection) {
    if (requiresMeasurements(product)) {
      measurementSection.style.display = 'block';
    } else {
      measurementSection.style.display = 'none';
      if (headCircumferenceInput) {
        headCircumferenceInput.value = '';
      }
      if (sizeSelectInput) {
        sizeSelectInput.value = '';
      }
      updateMeasurementInputs();
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

  updateScrunchieRowCountControl();
  updateDisabledOptions();
  updateThirdColorNote();
}

function serializeCustomOrder() {
  if (!customForm) return null;

  const product = getSelectedProduct();
  const selectedColors = getSelectedColors();
  const { headCircumference, size } = getMeasurementValues();
  const allOneColor = allOneColorCheckbox && allOneColorCheckbox.checked;
  const bucketHatStyle = bucketHatStyleSelect ? bucketHatStyleSelect.value : '';
  const rowCount = scrunchieRowCountSelect ? Number(scrunchieRowCountSelect.value || '1') : 1;

  if (!product || !selectedColors.length) return null;

  let colors = selectedColors;
  if (allOneColor && supportsAllOneColor(product)) {
    const expectedCount = getProductColorLabels(product).length;
    colors = Array(expectedCount).fill(selectedColors[0]);
  }

  return {
    product,
    colors,
    headCircumference,
    size,
    allOneColor: Boolean(allOneColor),
    bucketHatStyle,
    rowCount
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

function saveBillingDetails() {
  if (!checkoutForm || !rememberDetailsCheckbox) return;
  const data = {};
  ['fullName', 'email', 'street', 'city', 'state', 'postal'].forEach(name => {
    const field = checkoutForm.querySelector(`[name="${name}"]`);
    if (field) {
      data[name] = field.value.trim();
    }
  });
  window.localStorage.setItem(billingDetailsKey, JSON.stringify(data));
  window.localStorage.setItem(rememberDetailsKey, 'true');
}

function clearBillingDetails() {
  window.localStorage.removeItem(billingDetailsKey);
  window.localStorage.removeItem(rememberDetailsKey);
}

function buildCheckoutPayload(form) {
  if (!form) return null;
  const emailField = form.querySelector('input[name="email"]');
  const fullNameField = form.querySelector('input[name="fullName"]');
  const streetField = form.querySelector('input[name="street"]');
  const cityField = form.querySelector('input[name="city"]');
  const stateField = form.querySelector('select[name="state"]');
  const postalField = form.querySelector('input[name="postal"]');
  const shippingKey = shippingSelect && shippingSelect.value ? shippingSelect.value : 'standard';
  const loadedItems = loadOrderItems();
  const items = loadedItems.map(item => ({
    ...item,
    price: getProductPrice(item.product, item.colors.length, item.allOneColor, item.bucketHatStyle)
  }));
  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const shippingCost = getShippingPrice(shippingKey);

  return {
    fullName: fullNameField ? fullNameField.value.trim() : '',
    email: emailField ? emailField.value.trim() : '',
    street: streetField ? streetField.value.trim() : '',
    city: cityField ? cityField.value.trim() : '',
    state: stateField ? stateField.value.trim() : '',
    postal: postalField ? postalField.value.trim() : '',
    shipping: shippingKey,
    shippingCost,
    total: subtotal + shippingCost,
    items,
  };
}

function isStripeConfigured() {
  return stripeConfig.publishableKey && Object.values(stripeConfig.priceIds).every(Boolean);
}

function getStripeLineItems() {
  const items = loadOrderItems();
  const counts = items.reduce((acc, item) => {
    acc[item.product] = (acc[item.product] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts).map(([product, quantity]) => ({
    price: stripeConfig.priceIds[product],
    quantity
  })).filter(line => line.price && line.quantity > 0);
}

function showStripeStatus(message) {
  if (!stripeStatusMessage) return;
  stripeStatusMessage.textContent = message;
}

async function handleStripeCheckout() {
  if (!isStripeConfigured()) {
    showStripeStatus('Stripe is not configured yet. Add your publishable key and price IDs in site.js.');
    return;
  }

  const payload = buildCheckoutPayload(checkoutForm);
  if (!payload || !payload.email || !payload.items?.length) {
    showStripeStatus('Complete your order and add a valid email before starting Stripe checkout.');
    return;
  }

  const response = await fetch('/create-checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      lineItems: getStripeLineItems()
    })
  });

  const result = await response.json();
  if (!response.ok || !result.url) {
    showStripeStatus(result.message || 'Unable to start Stripe checkout.');
    return;
  }

  window.location.href = result.url;
}

function addCurrentOrderItem() {
  const order = serializeCustomOrder();
  if (!order) return false;
  const items = loadOrderItems();
  items.push(order);
  saveOrderItems(items);
  if (window.sessionStorage) {
    window.sessionStorage.setItem(orderSessionKey, 'true');
  }
  return true;
}

function clearOrderSession() {
  if (window.sessionStorage) {
    window.sessionStorage.removeItem(orderSessionKey);
  }
}

function clearStaleOrderItems() {
  if (!window.sessionStorage) return;
  if (!window.sessionStorage.getItem(orderSessionKey)) {
    saveOrderItems([]);
  }
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

function loadSavedBillingDetails() {
  if (!checkoutForm || !rememberDetailsCheckbox) return;
  try {
    const saved = window.localStorage.getItem(billingDetailsKey);
    const remember = window.localStorage.getItem(rememberDetailsKey) === 'true';
    if (!saved || !remember) return;
    const data = JSON.parse(saved);
    ['fullName', 'email', 'street', 'city', 'state', 'postal'].forEach(name => {
      const field = checkoutForm.querySelector(`[name="${name}"]`);
      if (field && data[name]) {
        field.value = data[name];
      }
    });
    rememberDetailsCheckbox.checked = true;
  } catch {
    // ignore invalid saved data
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

function getMeasurementText(order) {
  if (!order) return '';
  if (order.headCircumference) {
    return `Measurement: ${order.headCircumference} in`;
  }
  if (order.size) {
    return `Size: ${order.size}`;
  }
  return '';
}

function getOrderMetaText(order) {
  if (!order) return '';
  const colorText = order.allOneColor && order.colors.length
    ? `All one color: ${order.colors[0]}`
    : `${order.colors.join(', ')}`;
  const parts = [colorText];

  if (order.product === 'Scrunchie') {
    parts.push(`Rows: ${order.rowCount || 1}`);
  }

  const measurementText = getMeasurementText(order);
  if (measurementText) {
    parts.push(measurementText);
  }

  return parts.filter(Boolean).join(' • ');
}

function hasBucketHatOrder(items) {
  return items.some(item => item.product === 'Bucket Hat' || item.product === 'Beanie' || item.product === 'Ruffle Bucket Hat');
}

function updateShippingVisibility() {
  if (!shippingSelect) return;
  const shippingBlock = shippingSelect.closest('.checkout-block');
  const items = loadOrderItems();
  const showShipping = items.length > 0 && !hasBucketHatOrder(items);

  if (shippingBlock) {
    shippingBlock.style.display = showShipping ? '' : 'none';
  }

  if (showShipping) {
    shippingSelect.required = true;
    if (!shippingSelect.value) {
      shippingSelect.value = 'standard';
    }
  } else {
    shippingSelect.required = false;
    shippingSelect.value = 'standard';
  }
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

function removeOrderItem(index) {
  const items = loadOrderItems();
  if (index < 0 || index >= items.length) return false;
  items.splice(index, 1);
  saveOrderItems(items);
  return true;
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
    const itemMeta = getOrderMetaText(item);
    const itemPrice = getProductPrice(item.product, item.colors.length, item.allOneColor, item.bucketHatStyle);
    return `
      <div class="cart-list-item">
        <div>
          <strong>${index + 1}. ${item.product}</strong>
          <p>${itemMeta}</p>
        </div>
        <div class="cart-list-actions">
          <span>$${itemPrice}</span>
          <button type="button" class="delete-order-item" data-index="${index}">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateCheckoutSummary() {
  if (new URLSearchParams(window.location.search).get('payment') === 'success') {
    if (checkoutMessage) {
      checkoutMessage.textContent = 'Payment successful! Thank you for your order.';
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const items = loadOrderItems();
  if (!summaryProduct || !summaryColors || !summaryProductPrice || !summaryShipping || !summaryTotal || !checkoutItemList || !singleSummaryItem || !summaryExtraLine || !summaryExtra) return;

  if (!items.length) {
    if (shippingSelect) {
      updateShippingVisibility();
    }
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

  if (shippingSelect) {
    updateShippingVisibility();
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
    summaryColors.textContent = getOrderMetaText(order);
    summaryProductPrice.textContent = `$${subtotal}`;
  } else {
    singleSummaryItem.style.display = 'none';
    checkoutItemList.style.display = 'grid';
    checkoutItemList.innerHTML = items.map((order, index) => {
      const itemMeta = getOrderMetaText(order);
      const price = getProductPrice(order.product, order.colors.length, order.allOneColor, order.bucketHatStyle);
      return `
        <div class="checkout-item-row">
          <div>
            <p class="item-title">${index + 1}. ${order.product}</p>
            <p class="item-meta">${itemMeta}</p>
          </div>
          <div class="cart-list-actions">
            <strong>$${price}</strong>
            <button type="button" class="delete-order-item" data-index="${index}">Delete</button>
          </div>
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

function buildReceiptPreview(form) {
  if (!checkoutForm) return '';
  const emailField = form.querySelector('input[name="email"]');
  const email = emailField ? emailField.value.trim() : '';
  const items = loadOrderItems();
  const shippingKey = shippingSelect && shippingSelect.value ? shippingSelect.value : 'standard';
  const shippingCost = getShippingPrice(shippingKey);
  const subtotal = items.reduce((sum, item) => {
    return sum + getProductPrice(item.product, item.colors.length, item.allOneColor, item.bucketHatStyle);
  }, 0);
  const total = subtotal + shippingCost;
  const lines = items.map((item, index) => {
    const meta = getOrderMetaText(item);
    const price = getProductPrice(item.product, item.colors.length, item.allOneColor, item.bucketHatStyle);
    return `${index + 1}. ${item.product} (${meta}) — $${price}`;
  });
  return `Receipt will be sent to ${email || 'your email address'}.

${lines.join('\n')}

Shipping: $${shippingCost}
Total: $${total}`;
}

function openReceiptEmail(form) {
  if (!form) return;
  const emailField = form.querySelector('input[name="email"]');
  const email = emailField ? emailField.value.trim() : '';
  if (!email) {
    if (checkoutMessage) {
      checkoutMessage.textContent = 'Please add an email address before opening the receipt email.';
    }
    return;
  }
  const receiptText = buildReceiptPreview(form);
  const subject = encodeURIComponent('Stitched By Trae Purchase Receipt');
  const body = encodeURIComponent(receiptText);
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const payload = buildCheckoutPayload(form);

  if (!payload) {
    if (checkoutMessage) checkoutMessage.textContent = 'Please complete the order before submitting.';
    return;
  }

  if (!payload.email) {
    if (checkoutMessage) checkoutMessage.textContent = 'Please add an email address before submitting your order.';
    return;
  }

  if (!payload.items.length) {
    if (checkoutMessage) checkoutMessage.textContent = 'Add at least one item to your order before submitting.';
    return;
  }

  if (rememberDetailsCheckbox && rememberDetailsCheckbox.checked) {
    saveBillingDetails();
  } else {
    clearBillingDetails();
  }

  try {
    const response = await fetch('/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Unable to place order.');
    }

    if (checkoutMessage) {
      checkoutMessage.textContent = `Order #${result.orderNumber} placed successfully! Confirmation email sent.`;
    }

    saveOrderItems([]);
    clearOrderSession();

    if (receiptSummary) {
      receiptSummary.style.display = 'block';
      receiptSummary.textContent = buildReceiptPreview(form);
    }

    if (sendReceiptButton) {
      sendReceiptButton.style.display = 'inline-block';
    }

    if (shippingSelect) shippingSelect.value = '';
    updateCheckoutSummary();
    setTimeout(() => {
      if (checkoutMessage) checkoutMessage.textContent = '';
    }, 5000);
  } catch (error) {
    console.error(error);
    if (checkoutMessage) checkoutMessage.textContent = error.message || 'Order submission failed.';
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
  
  if (scrunchieRowCountSelect) {
  scrunchieRowCountSelect.addEventListener('change', () => {
    updateColorPickers();
  });
}
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

if (headCircumferenceInput) {
  headCircumferenceInput.addEventListener('input', updateMeasurementInputs);
}

if (sizeSelectInput) {
  sizeSelectInput.addEventListener('change', updateMeasurementInputs);
}

function handleDeleteClick(event) {
  const button = event.target.closest('.delete-order-item');
  if (!button) return;
  const index = Number(button.dataset.index);
  if (Number.isNaN(index)) return;
  if (removeOrderItem(index)) {
    renderCartList();
    updateCheckoutSummary();
    if (customMessage) customMessage.textContent = 'Item removed from your order.';
  }
}

if (orderCartList) {
  orderCartList.addEventListener('click', handleDeleteClick);
}

if (checkoutItemList) {
  checkoutItemList.addEventListener('click', handleDeleteClick);
}

if (checkoutForm) {
  checkoutForm.addEventListener('submit', handleFormSubmit);
}

if (stripeCheckoutButton) {
  stripeCheckoutButton.addEventListener('click', handleStripeCheckout);
}

if (sendReceiptButton) {
  sendReceiptButton.addEventListener('click', () => {
    if (checkoutForm) {
      openReceiptEmail(checkoutForm);
    }
  });
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
  updateMeasurementInputs();
  clearStaleOrderItems();
  renderCartList();
  updateCheckoutSummary();
  loadSavedBillingDetails();
});
