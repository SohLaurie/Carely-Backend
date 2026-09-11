const reviewsService = require('./reviews.service')

async function submitReview(req, res, next) {
  try {
    const review = await reviewsService.submitReview(req.user.id, req.body)
    res.status(201).json({
      message: 'Review submitted. Thank you for your feedback!',
      review,
    })
  } catch (err) { next(err) }
}

async function getProviderReviews(req, res, next) {
  try {
    const result = await reviewsService.getProviderReviews(req.params.id, req.query)
    res.json(result)
  } catch (err) { next(err) }
}

module.exports = { submitReview, getProviderReviews }
