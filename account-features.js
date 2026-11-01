const PHOTO_REVIEW_DISCLAIMER = `By uploading a photo with your review, you acknowledge that your photo may be publicly displayed on the Stitched By Trae website alongside your review.

You grant Stitched By Trae permission to display your uploaded photo for customer review and promotional purposes.

Once submitted and published, reviews and photos cannot be edited or removed by customers themselves. Photos are intended to remain published permanently, subject to applicable law and privacy policies.

Only upload photos you own or have permission to share. Anyone pictured should have consented to public display.`;

function accountFeatureEscape(value) {
    const element = document.createElement('span');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
}

function setAccountFeatureMessage(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.style.color = isError ? '#b00020' : '#276335';
}

async function requestAccountFeature(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to complete this request.');
    return data;
}

function renderEligibleReviews(orders) {
    const container = document.getElementById('eligible-reviews');
    if (!container) return;
    if (!orders.length) {
        container.innerHTML = '<p>No delivered orders need a review right now.</p>';
        return;
    }

    container.innerHTML = orders.map(order => `
        <article class="review-card">
            <h4>${accountFeatureEscape(order.productName)} · Order ${accountFeatureEscape(order.orderNumber)}</h4>
            <p>Delivered ${new Date(order.deliveredAt).toLocaleDateString()}</p>
            <form class="review-form" data-review-form>
                <input type="hidden" name="orderId" value="${Number(order.orderId)}">
                <input type="hidden" name="productName" value="${accountFeatureEscape(order.productName)}">
                <label>Star rating
                    <select name="rating" required>
                        <option value="">Choose 1–5 stars</option>
                        <option value="5">★★★★★ — 5 stars</option>
                        <option value="4">★★★★☆ — 4 stars</option>
                        <option value="3">★★★☆☆ — 3 stars</option>
                        <option value="2">★★☆☆☆ — 2 stars</option>
                        <option value="1">★☆☆☆☆ — 1 star</option>
                    </select>
                </label>
                <label>Written review
                    <textarea name="body" maxlength="5000" required placeholder="Share your experience"></textarea>
                </label>
                <label>Customer photo (optional)
                    <input type="file" name="photo" accept="image/jpeg,image/png,image/webp">
                </label>
                <div class="review-consent-copy">${accountFeatureEscape(PHOTO_REVIEW_DISCLAIMER).replace(/\n/g, '<br>')}</div>
                <label class="review-consent-check">
                    <input type="checkbox" name="photoConsent" value="true">
                    <span>I understand and agree to the photo upload and display terms.</span>
                </label>
                <p class="form-message" data-review-message aria-live="polite"></p>
                <button type="submit" class="button">Submit Review</button>
            </form>
        </article>
    `).join('');
}

function renderSubmittedReviews(reviews) {
    const container = document.getElementById('submitted-reviews');
    if (!container) return;
    if (!reviews.length) {
        container.innerHTML = '<p>You have not submitted any reviews yet.</p>';
        return;
    }
    container.innerHTML = `
        <h4>Your Submitted Reviews</h4>
        ${reviews.map(review => `
            <article class="review-card">
                <h4>${accountFeatureEscape(review.product_name)} · ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</h4>
                <p>${accountFeatureEscape(review.body)}</p>
                <p><strong>Status:</strong> ${accountFeatureEscape(review.status)}</p>
                ${review.photoUrl ? `<img class="review-photo" src="${accountFeatureEscape(review.photoUrl)}" alt="Photo submitted with review of ${accountFeatureEscape(review.product_name)}">` : ''}
                ${review.admin_response ? `<p><strong>Response from Stitched By Trae:</strong> ${accountFeatureEscape(review.admin_response)}</p>` : ''}
                ${review.status !== 'removed' ? `<button type="button" class="button secondary" data-removal-review="${Number(review.id)}">Request privacy-related removal</button>` : ''}
                <p>Reviews cannot be edited or deleted by customers. You may send a legal or privacy-related removal request for review by the team.</p>
            </article>
        `).join('')}
    `;
}

async function loadAccountReviews() {
    const [eligible, reviews] = await Promise.all([
        requestAccountFeature('/api/reviews/eligible'),
        requestAccountFeature('/api/reviews/mine')
    ]);
    renderEligibleReviews(eligible);
    renderSubmittedReviews(reviews);
}

function renderRewards(data) {
    document.getElementById('rewards-points').textContent = String(data.points);
    const redeem = document.getElementById('redeem-points-button');
    redeem.disabled = data.points < 500;

    const birthday = document.getElementById('birthday-input');
    birthday.value = data.birthday || '';
    birthday.disabled = data.birthdayLocked;
    document.getElementById('save-birthday-button').disabled = data.birthdayLocked;
    if (data.birthdayLocked) {
        document.getElementById('birthday-message').textContent = 'Birthday saved. Contact support if you need to request a correction.';
    }

    document.getElementById('review-email-preference').checked = data.emailPreferences.reviewRequests;
    document.getElementById('marketing-email-preference').checked = data.emailPreferences.marketing;
    document.getElementById('referral-link').value = data.referralUrl;

    const discounts = document.getElementById('available-discounts');
    discounts.innerHTML = data.discounts.length ? data.discounts.map(discount => `
        <div class="discount-card">
            <strong>${accountFeatureEscape(discount.kind === 'birthday_bogo' ? 'Birthday BOGO' : '$5 Trae Rewards')}</strong>
            <p>Code: <code>${accountFeatureEscape(discount.code)}</code> · ${accountFeatureEscape(discount.status)}</p>
            ${discount.kind === 'birthday_bogo' ? '<p>Buy one eligible ready-to-ship hat and get another of equal or lesser value free. Add two of the eligible item to your order and apply this code at checkout.</p>' : ''}
        </div>
    `).join('') : '<p>No discounts available yet.</p>';

    const history = document.getElementById('rewards-history');
    history.innerHTML = data.history.length ? data.history.map(entry => `
        <div class="reward-history-row">
            <strong>${entry.points > 0 ? '+' : ''}${Number(entry.points)} points</strong>
            <span>${accountFeatureEscape(entry.activity)}</span>
            <small>${new Date(entry.created_at).toLocaleDateString()}</small>
        </div>
    `).join('') : '<p>No points activity yet.</p>';
}

async function loadAccountRewards() {
    const data = await requestAccountFeature('/api/customer/rewards');
    renderRewards(data);
}

document.getElementById('eligible-reviews')?.addEventListener('submit', async event => {
    const form = event.target.closest('[data-review-form]');
    if (!form) return;
    event.preventDefault();
    const photo = form.elements.photo.files[0];
    if (photo && !form.elements.photoConsent.checked) {
        form.querySelector('[data-review-message]').textContent = 'Please agree to the photo upload and display terms.';
        return;
    }
    const submit = form.querySelector('button[type="submit"]');
    const message = form.querySelector('[data-review-message]');
    submit.disabled = true;
    message.textContent = 'Submitting…';
    try {
        await requestAccountFeature('/api/reviews', { method: 'POST', body: new FormData(form) });
        message.textContent = 'Review submitted. It cannot be edited or deleted by customers.';
        await loadAccountReviews();
        await loadAccountRewards();
    } catch (error) {
        message.textContent = error.message;
        message.style.color = '#b00020';
        submit.disabled = false;
    }
});

document.getElementById('submitted-reviews')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-removal-review]');
    if (!button) return;
    const reason = window.prompt('Describe your legal or privacy-related removal request:');
    if (!reason || !reason.trim()) return;
    button.disabled = true;
    try {
        await requestAccountFeature(`/api/reviews/${button.dataset.removalReview}/removal-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason.trim() })
        });
        button.textContent = 'Removal request submitted';
    } catch (error) {
        button.disabled = false;
        window.alert(error.message);
    }
});

document.getElementById('save-birthday-button')?.addEventListener('click', async () => {
    try {
        const birthday = document.getElementById('birthday-input').value;
        await requestAccountFeature('/api/customer/birthday', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ birthday })
        });
        document.getElementById('birthday-input').disabled = true;
        document.getElementById('save-birthday-button').disabled = true;
        setAccountFeatureMessage('birthday-message', 'Birthday saved.');
    } catch (error) {
        setAccountFeatureMessage('birthday-message', error.message, true);
    }
});

document.getElementById('save-email-preferences')?.addEventListener('click', async () => {
    try {
        await requestAccountFeature('/api/customer/email-preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reviewRequests: document.getElementById('review-email-preference').checked,
                marketing: document.getElementById('marketing-email-preference').checked
            })
        });
        setAccountFeatureMessage('preferences-message', 'Email preferences saved.');
    } catch (error) {
        setAccountFeatureMessage('preferences-message', error.message, true);
    }
});

document.getElementById('redeem-points-button')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
        const result = await requestAccountFeature('/api/customer/reward-redemptions', { method: 'POST' });
        setAccountFeatureMessage('rewards-message', `500 points redeemed. Your $5 code is ${result.code}.`);
        await loadAccountRewards();
    } catch (error) {
        setAccountFeatureMessage('rewards-message', error.message, true);
        event.currentTarget.disabled = false;
    }
});

document.getElementById('copy-referral-button')?.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(document.getElementById('referral-link').value);
        setAccountFeatureMessage('referral-message', 'Referral link copied.');
    } catch {
        setAccountFeatureMessage('referral-message', 'Copy the referral link from the field above.', true);
    }
});

Promise.all([loadAccountReviews(), loadAccountRewards()]).catch(error => {
    console.error('Unable to load account features:', error);
    setAccountFeatureMessage('rewards-message', 'Unable to load account features. Refresh the page to try again.', true);
});
