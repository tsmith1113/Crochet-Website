const colorChoices = [
  'Blush Pink',
  'Soft Cream',
  'Sage Green',
  'Mustard Yellow',
  'Lavender',
  'Charcoal Gray'
];

const colorCountSelect = document.getElementById('color-count-select');
const colorPickers = document.getElementById('color-pickers');
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');
const customForm = document.getElementById('custom-form');
const checkoutForm = document.getElementById('checkout-form');
const customMessage = document.getElementById('custom-form-message');
const checkoutMessage = document.getElementById('checkout-form-message');

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

function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const formId = form.id;
  const messageElement = formId === 'custom-form' ? customMessage : checkoutMessage;
  const messageText = formId === 'custom-form'
    ? 'Thanks! Your custom order request has been received.'
    : 'Thanks! Your checkout request is complete.';

  if (messageElement) {
    messageElement.textContent = messageText;
  }

  form.reset();
  if (colorCountSelect) {
    colorCountSelect.value = '';
  }
  updateColorPickers();

  setTimeout(() => {
    if (messageElement) {
      messageElement.textContent = '';
    }
  }, 5000);
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

window.addEventListener('DOMContentLoaded', () => {
  updateColorPickers();
});
