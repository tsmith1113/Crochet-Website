function productReviewEscape(value) {
    const element = document.createElement('span');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
}

async function loadPublishedProductReviews() {
    const section = document.querySelector('[data-product-reviews]');
    if (!section) return;
    const product = section.dataset.productReviews;
    const container = section.querySelector('.product-review-list');
    try {
        const response = await fetch(`/api/reviews/published?product=${encodeURIComponent(product)}`);
        const reviews = await response.json();
        if (!response.ok) throw new Error(reviews.error || 'Unable to load reviews.');
        if (!reviews.length) {
            container.innerHTML = '<p>No reviews yet. Customers can review after delivery.</p>';
            return;
        }
        const average = reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviews.length;
        container.innerHTML = `
            <p><strong>${average.toFixed(1)} out of 5</strong> · ${reviews.length} verified review${reviews.length === 1 ? '' : 's'}</p>
            ${reviews.map(review => `
                <article class="review-card">
                    <h3>${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} · Verified Purchase</h3>
                    <p>${productReviewEscape(review.body)}</p>
                    <small>${new Date(review.submitted_at).toLocaleDateString()}</small>
                    ${review.photoUrl ? `<img class="review-photo" src="${productReviewEscape(review.photoUrl)}" alt="Customer photo with product review">` : ''}
                    ${review.admin_response ? `<p><strong>Response from Stitched By Trae:</strong> ${productReviewEscape(review.admin_response)}</p>` : ''}
                </article>
            `).join('')}
        `;
    } catch (error) {
        console.error('Unable to load product reviews:', error);
        container.textContent = 'Reviews are temporarily unavailable.';
    }
}

loadPublishedProductReviews();
