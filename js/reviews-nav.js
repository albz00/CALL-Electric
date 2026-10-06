(function () {
  var section = document.getElementById('reviews');
  if (!section) return;

  function scrollToReviews() {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href="/#reviews"], a[href="#reviews"]');
    if (!link) return;
    event.preventDefault();
    if (location.hash !== '#reviews') {
      history.pushState(null, '', '#reviews');
    }
    scrollToReviews();
  }, true);

  if (location.hash === '#reviews') {
    window.addEventListener('load', function () {
      window.setTimeout(scrollToReviews, 60);
    });
  }
})();
