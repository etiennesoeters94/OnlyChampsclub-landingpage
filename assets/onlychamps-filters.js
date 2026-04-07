(function () {
  function parseStateFromPanel(panel) {
    var state = { price: [], groups: {} };
    var groupNodes = panel.querySelectorAll('[data-filter-group]');

    groupNodes.forEach(function (groupNode) {
      var groupName = groupNode.getAttribute('data-filter-group');
      var checkedValues = Array.from(groupNode.querySelectorAll('input[type="checkbox"]:checked')).map(function (input) {
        return String(input.value || '').toLowerCase();
      });

      if (groupName === 'price') {
        state.price = checkedValues;
      } else if (checkedValues.length) {
        state.groups[groupName] = checkedValues;
      }
    });

    return state;
  }

  function syncPanels(panels, sourcePanel) {
    var sourceInputs = sourcePanel.querySelectorAll('[data-filter-group] input[type="checkbox"]');
    var checkedMap = {};

    sourceInputs.forEach(function (input) {
      var group = input.closest('[data-filter-group]').getAttribute('data-filter-group');
      checkedMap[group + '::' + input.value] = input.checked;
    });

    panels.forEach(function (panel) {
      if (panel === sourcePanel) return;

      panel.querySelectorAll('[data-filter-group] input[type="checkbox"]').forEach(function (input) {
        var group = input.closest('[data-filter-group]').getAttribute('data-filter-group');
        var key = group + '::' + input.value;
        input.checked = !!checkedMap[key];
      });
    });
  }

  function priceMatches(selectedPriceRanges, productPriceEur) {
    if (!selectedPriceRanges.length) return true;

    return selectedPriceRanges.some(function (range) {
      if (range === 'under-40') return productPriceEur < 40;
      if (range === '40-60') return productPriceEur >= 40 && productPriceEur < 60;
      if (range === '60-100') return productPriceEur >= 60 && productPriceEur < 100;
      if (range === '100-plus') return productPriceEur >= 100;
      return false;
    });
  }

  function tagGroupMatches(selectedValues, productTagsSet) {
    if (!selectedValues || !selectedValues.length) return true;

    return selectedValues.some(function (value) {
      return productTagsSet.has(value);
    });
  }

  function applyFilters(state, cards, visibleCountEl, noResultsEl) {
    var visible = 0;

    cards.forEach(function (card) {
      var wrapper = card.closest('[data-oc-product-card-wrapper]');
      var priceCents = Number(card.getAttribute('data-price-cents') || 0);
      var productPriceEur = priceCents / 100;
      var tagsRaw = String(card.getAttribute('data-tags') || '').toLowerCase();
      var tags = tagsRaw ? tagsRaw.split('|').map(function (t) { return t.trim(); }).filter(Boolean) : [];
      var tagSet = new Set(tags);

      var matches = priceMatches(state.price, productPriceEur);

      if (matches) {
        Object.keys(state.groups).forEach(function (groupKey) {
          if (!matches) return;
          matches = tagGroupMatches(state.groups[groupKey], tagSet);
        });
      }

      wrapper.classList.toggle('oc-filter-hidden', !matches);
      if (matches) visible += 1;
    });

    if (visibleCountEl) {
      visibleCountEl.textContent = String(visible);
    }

    if (noResultsEl) {
      noResultsEl.hidden = visible !== 0;
    }
  }

  function closeMobileDrawer(drawerRoot) {
    if (!drawerRoot) return;
    drawerRoot.hidden = true;
    document.body.classList.remove('oc-mobile-filters-open');
  }

  function openMobileDrawer(drawerRoot) {
    if (!drawerRoot) return;
    drawerRoot.hidden = false;
    document.body.classList.add('oc-mobile-filters-open');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.querySelector('[data-oc-collection-filters]');
    if (!root) return;

    var cards = Array.from(root.querySelectorAll('[data-oc-product-card]'));
    var visibleCountEl = root.querySelector('[data-oc-visible-count]');
    var noResultsEl = root.querySelector('[data-oc-no-results]');
    var filterPanels = Array.from(root.querySelectorAll('[data-oc-filter-panel]'));
    var mobileDrawer = root.querySelector('[data-oc-mobile-filters]');

    root.querySelectorAll('[data-oc-open-mobile-filters]').forEach(function (button) {
      button.addEventListener('click', function () {
        openMobileDrawer(mobileDrawer);
      });
    });

    root.querySelectorAll('[data-oc-close-mobile-filters]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeMobileDrawer(mobileDrawer);
      });
    });

    // Lees ?filter= query-param en activeer de bijbehorende checkbox(es) automatisch
    (function () {
      var params = new URLSearchParams(window.location.search);
      var filterParam = params.get('filter');
      if (!filterParam) return;

      // Ondersteun meerdere filters via komma, bijv. ?filter=under-40,40-60,gelegenheid-cadeau
      // Prijswaarden blijven raw (under-40, 40-60, 60-100, 100-plus), overige waarden krijgen filter- prefix.
      var rawPriceValues = ['under-40', '40-60', '60-100', '100-plus'];
      var filterValues = filterParam.split(',').map(function (v) {
        var normalized = v.trim().toLowerCase();
        if (!normalized) return '';
        if (normalized.indexOf('filter-') === 0) return normalized;
        if (rawPriceValues.indexOf(normalized) !== -1) return normalized;
        return 'filter-' + normalized;
      }).filter(Boolean);

      filterPanels.forEach(function (panel) {
        panel.querySelectorAll('[data-filter-group] input[type="checkbox"]').forEach(function (input) {
          if (filterValues.indexOf(String(input.value).toLowerCase()) !== -1) {
            input.checked = true;
          }
        });
      });

      // Pas filters toe op basis van de net-gecheckte state
      var firstPanel = filterPanels[0];
      if (firstPanel) {
        syncPanels(filterPanels, firstPanel);
        var urlState = parseStateFromPanel(firstPanel);
        applyFilters(urlState, cards, visibleCountEl, noResultsEl);
      }
    })();

    filterPanels.forEach(function (panel) {
      var applyButton = panel.querySelector('[data-oc-apply-filters]');
      var resetButton = panel.querySelector('[data-oc-reset-filters]');

      if (applyButton) {
        applyButton.addEventListener('click', function () {
          syncPanels(filterPanels, panel);
          var state = parseStateFromPanel(panel);
          applyFilters(state, cards, visibleCountEl, noResultsEl);
          closeMobileDrawer(mobileDrawer);
        });
      }

      if (resetButton) {
        resetButton.addEventListener('click', function () {
          panel.querySelectorAll('[data-filter-group] input[type="checkbox"]').forEach(function (input) {
            input.checked = false;
          });

          syncPanels(filterPanels, panel);
          var clearedState = parseStateFromPanel(panel);
          applyFilters(clearedState, cards, visibleCountEl, noResultsEl);
        });
      }
    });
  });
})();
