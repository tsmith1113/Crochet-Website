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

function createColorSelect(index) {
  const wrapper = document.createElement('label');
  wrapper.className = 'color-select-group';

  const title = document.createElement('span');
  title.textContent = `Color ${index + 1}`;

  const select = document.createElement('select');
  select.className = 'color-select';
  select.required = true;
  select.dataset.index = index;
  select.innerHTML = `
    <option value="">Select Color</option>
    ${colorChoices.map(color => `<option value="${color}">${color}</option>`).join('')}
  `;

  wrapper.append(title, select);
  return wrapper;
}

function getSelectedColors() {
  return Array.from(colorPickers.querySelectorAll('.color-select'))
    .map(select => select.value)
    .filter(Boolean);
}

function updateDisabledOptions() {
  const selectedColors = getSelectedColors();
  const colorSelects = colorPickers.querySelectorAll('.color-select');

  colorSelects.forEach(select => {
    const currentValue = select.value;

    Array.from(select.options).forEach(option => {
      if (!option.value) {
        option.disabled = false;
        return;
      }

      const isSelectedElsewhere = selectedColors.includes(option.value) && option.value !== currentValue;
      option.disabled = isSelectedElsewhere;
    });
  });
}

function updateColorPickers() {
  const count = parseInt(colorCountSelect.value, 10) || 0;
  const currentPickers = Array.from(colorPickers.querySelectorAll('.color-select-group'));
  const firstSelect = currentPickers[0]?.querySelector('.color-select');

  if (!firstSelect) {
    colorPickers.appendChild(createColorSelect(0));
  }

  const desiredPickers = [];
  desiredPickers.push(createColorSelect(0));

  if (count >= 2 && firstSelect.value) {
    desiredPickers.push(createColorSelect(1));
  }

  if (count >= 3) {
    const secondSelect = currentPickers[1]?.querySelector('.color-select');
    if (secondSelect && secondSelect.value) {
      desiredPickers.push(createColorSelect(2));
    }
  }

  const values = currentPickers.map(group => group.querySelector('.color-select').value);
  const activeCount = desiredPickers.length;

  colorPickers.innerHTML = '';
  desiredPickers.forEach((picker, index) => {
    const select = picker.querySelector('.color-select');
    select.dataset.index = index;
    if (values[index]) {
      select.value = values[index];
    }
    colorPickers.appendChild(picker);
  });

  if (activeCount === 0) {
    colorPickers.appendChild(createColorSelect(0));
  }

  updateDisabledOptions();
}

colorCountSelect.addEventListener('change', () => {
  updateColorPickers();
});

colorPickers.addEventListener('change', event => {
  if (event.target.classList.contains('color-select')) {
    updateColorPickers();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  updateColorPickers();
});
